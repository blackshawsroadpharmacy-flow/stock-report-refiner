import { useCallback, useEffect, useRef, useState } from "react";
import {
  processFosFile,
  downloadWorkbook,
  HEADERS,
  type ProcessResult,
} from "@/lib/fos-processor";
import { analyze, type AnalysisResult } from "@/lib/fos-analyzer";
import { buildAndDownloadAnalysisWorkbook } from "@/lib/fos-excel-export";
import { StockAnalysisReport } from "./StockAnalysisReport";
import {
  storeFile,
  loadFile,
  clearFile,
  storeFlag,
  loadFlag,
  clearFlag,
} from "@/lib/persistentStorage";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | { kind: "success"; filename: string; result: ProcessResult }
  | { kind: "error"; message: string };

const STORAGE_KEY_ANALYSIS_FLAG = "fos-cleaner:has-analysis-v1";

export function FosCleaner() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelToast, setExcelToast] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (analysis && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [analysis]);

  // Restore last uploaded file (and re-run analysis if it was previously generated)
  useEffect(() => {
    let cancelled = false;
    loadFile().then((stored) => {
      if (cancelled || !stored) return;
      const file = new File([stored.buffer], stored.filename, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      setStatus({ kind: "loading", filename: file.name });
      processFosFile(file).then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setStatus({ kind: "error", message: result.error });
          return;
        }
        setStatus({ kind: "success", filename: file.name, result });
        loadFlag(STORAGE_KEY_ANALYSIS_FLAG).then((flag) => {
          if (flag === "1") {
            try {
              setAnalysis(analyze(result.rows));
            } catch {
              // user can re-run manually
            }
          }
        });
      });
    }).catch((err) => {
      setRestoreError(err?.message || "Failed to restore previous file");
      clearFile().catch(() => {});
      clearFlag(STORAGE_KEY_ANALYSIS_FLAG).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setStatus({ kind: "error", message: "Please upload a .xlsx file." });
      return;
    }
    setStatus({ kind: "loading", filename: file.name });
    const buf = await file.arrayBuffer();
    const result = await processFosFile(
      new File([buf], file.name, { type: file.type }),
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    setStatus({ kind: "success", filename: file.name, result });
    try {
      await storeFile(file.name, buf);
      await clearFlag(STORAGE_KEY_ANALYSIS_FLAG);
    } catch {
      // IndexedDB unavailable — non-fatal
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const reset = async () => {
    setStatus({ kind: "idle" });
    setAnalysis(null);
    setAnalysing(false);
    setExportingExcel(false);
    setExcelToast(null);
    setRestoreError(null);
    if (inputRef.current) inputRef.current.value = "";
    try {
      await clearFile();
      await clearFlag(STORAGE_KEY_ANALYSIS_FLAG);
    } catch {
      // ignore
    }
  };

  const onDownload = () => {
    if (status.kind !== "success") return;
    downloadWorkbook(status.result.workbook, status.result.filename);
  };

  const onRunAnalysis = async () => {
    if (status.kind !== "success") return;
    setAnalysing(true);
    // Yield to browser so the spinner paints before the synchronous analyze() blocks
    await new Promise((r) => requestAnimationFrame(r));
    const result = analyze(status.result.rows);
    setAnalysis(result);
    setAnalysing(false);
    try {
      await storeFlag(STORAGE_KEY_ANALYSIS_FLAG, "1");
    } catch {
      // ignore
    }
  };

  const onDownloadAnalysisExcel = async () => {
    if (status.kind !== "success") return;
    setExportingExcel(true);
    setExcelToast(null);
    try {
      await new Promise((r) => setTimeout(r, 50));
      const summary = buildAndDownloadAnalysisWorkbook(status.result.rows);
      setExcelToast(
        `✓ Analysis exported — ${summary.productCount} products, ${summary.flagCount} flags raised`,
      );
      window.setTimeout(() => setExcelToast(null), 5000);
    } catch (e: any) {
      setExcelToast(`✗ Export failed — ${e?.message || "unknown error"}`);
    } finally {
      setExportingExcel(false);
    }
  };

  const previewRows =
    status.kind === "success" ? status.result.rows.slice(0, 5) : [];

  const fmtCell = (v: any) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toLocaleDateString("en-AU");
    return String(v);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            FOS Stock Report Cleaner
          </h1>
          <p className="mt-2 text-sm opacity-80 sm:text-base">
            Blackshaws Road Pharmacy — Z Office Export Formatter
          </p>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            className={[
              "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
              dragActive
                ? "border-primary bg-accent"
                : "border-border bg-muted/40 hover:border-primary hover:bg-accent",
            ].join(" ")}
          >
            <svg
              className="mb-4 h-10 w-10 text-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            <p className="text-base font-medium text-foreground">
              Drop your FOS Stock Report here, or click to browse
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Accepts .xlsx files exported from Z Office
            </p>
            {status.kind !== "idle" && (
              <p className="mt-3 text-sm text-muted-foreground">
                Selected:{" "}
                <span className="font-medium text-foreground">
                  {status.kind === "loading"
                    ? status.filename
                    : status.kind === "success"
                      ? status.filename
                      : ""}
                </span>
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onChange}
            />
          </div>

          {/* Status messages */}
          <div className="mt-5 min-h-[2rem]">
            {status.kind === "loading" && (
              <div className="flex items-center gap-3 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Processing…
              </div>
            )}
            {status.kind === "success" && (
              <div className="rounded-md bg-success/10 px-4 py-3 text-sm font-medium text-success">
                ✓ {status.result.rowCount} products loaded — ready to analyse
              </div>
            )}
            {status.kind === "error" && (
              <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                ✗ {status.message}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={status.kind !== "success"}
              onClick={onDownload}
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download Cleaned Report (.xlsx)
            </button>
            <button
              type="button"
              disabled={status.kind !== "success" || analysing}
              onClick={onRunAnalysis}
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              📊 Run Stock Analysis
            </button>
            <button
              type="button"
              disabled={status.kind !== "success" || exportingExcel}
              onClick={onDownloadAnalysisExcel}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exportingExcel && (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              )}
              📥 Download Analysis (.xlsx)
            </button>
            {status.kind !== "idle" && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                Reset
              </button>
            )}
          </div>

          {/* Excel export status */}
          {(exportingExcel || excelToast) && (
            <div className="mt-4">
              {exportingExcel && (
                <div className="flex items-center gap-3 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Building your analysis workbook…
                </div>
              )}
              {!exportingExcel && excelToast && (
                <div
                  className={`rounded-md px-4 py-3 text-sm font-medium ${
                    excelToast.startsWith("✓")
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {excelToast}
                </div>
              )}
            </div>
          )}

          {/* Analysis progress */}
          {analysing && (
            <div className="mt-4 flex items-center gap-3 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Analysing…
            </div>
          )}

          {/* Preview */}
          {status.kind === "success" && (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Preview — first 5 rows
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-primary text-primary-foreground">
                    <tr>
                      {HEADERS.map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-2 text-left font-semibold"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={ri % 2 === 0 ? "bg-card" : "bg-muted/40"}
                      >
                        {HEADERS.map((_, ci) => (
                          <td
                            key={ci}
                            className="whitespace-nowrap px-3 py-2 text-foreground"
                          >
                            {fmtCell(row[ci])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          All processing happens in your browser — no data leaves your device.
        </p>

        {analysis && (
          <div ref={reportRef} className="mt-10">
            <StockAnalysisReport result={analysis} onReset={reset} />
          </div>
        )}
      </main>
    </div>
  );
}
