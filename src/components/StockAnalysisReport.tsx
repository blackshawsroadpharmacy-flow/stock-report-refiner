import { useMemo, useRef, useState, Suspense, lazy, useDeferredValue } from "react";
import {
  type AnalysisResult,
  type Flag,
  type ProductAnalysis,
  fmtAUD,
  fmtPct,
  fmtDate,
} from "@/lib/fos-analyzer";
const DeeperDiveModal = lazy(async () => {
  const { DeeperDiveModal } = await import("./deeper-dive/DeeperDiveModal");
  return { default: DeeperDiveModal };
});
import { useCompetitorPricing, productKey } from "@/hooks/useCompetitorPricing";
import { CONFIDENCE_OPTIONS, useConfidenceThreshold } from "@/hooks/useConfidenceThreshold";

// All report styles live in StockAnalysisReport.css so the downloaded HTML is
// fully self-contained when we inject the exported CSS string below.
import REPORT_CSS_RAW from "./StockAnalysisReport.css?raw";
export const REPORT_CSS = REPORT_CSS_RAW;

const SECTIONS: { num: number; title: string; emoji: string; subtitle?: (r: AnalysisResult) => string }[] = [
  { num: 1, title: "Critical Issues — Pricing Integrity", emoji: "🔴" },
  {
    num: 2,
    title: "Dead & Ghost Stock",
    emoji: "🟠",
    subtitle: (r) => `Total capital tied up in dead/slow stock: ${fmtAUD(r.totals.deadStockCapital)}`,
  },
  {
    num: 3,
    title: "Stockout Risks & Lost Sales",
    emoji: "🚨",
    subtitle: (r) =>
      `Estimated GP at risk from current stockouts: ${fmtAUD(r.totals.stockoutGpAtRisk)} / month`,
  },
  { num: 4, title: "Purchasing Efficiency", emoji: "📦" },
  { num: 5, title: "Top Performers", emoji: "⭐" },
  { num: 6, title: "Data Quality Issues", emoji: "⚠️" },
];

function bandClass(b: ProductAnalysis["scoreBand"]): string {
  switch (b) {
    case "Healthy": return "healthy";
    case "Monitor": return "monitor";
    case "Action Required": return "action";
    case "Urgent": return "urgent";
  }
}

function FlagCard({ pa, flag }: { pa: ProductAnalysis; flag: Flag }) {
  return (
    <div className={`flag-card ${flag.severity}`}>
      <div className="flag-head">
        <span className="product">{pa.product.stockName || "(no name)"}</span>
        {pa.product.pde && <span className="pde">PDE {pa.product.pde}</span>}
        <span className={`badge ${flag.severity}`}>Rule {flag.ruleId}</span>
      </div>
      <div className="flag-title">{flag.title}</div>
      <div className="metrics">
        {flag.metrics.map((m, i) => (
          <div className="metric" key={i}>
            <div className="k">{m.label}</div>
            <div className="v">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="action">
        <strong>Action: </strong>
        {flag.action}
      </div>
    </div>
  );
}

function Section({ result, num, title, emoji, subtitle }: {
  result: AnalysisResult;
  num: number; title: string; emoji: string;
  subtitle?: (r: AnalysisResult) => string;
}) {
  const items = result.byCategory[num] || [];
  const flagList: { pa: ProductAnalysis; flag: Flag }[] = [];
  for (const pa of items) {
    for (const f of pa.flags) if (f.category === num) flagList.push({ pa, flag: f });
  }
  if (num === 5) flagList.sort((a, b) => b.pa.product.salesGP - a.pa.product.salesGP);

  return (
    <section>
      <h2>{emoji} Section {num}: {title}</h2>
      {subtitle && flagList.length > 0 && <div className="subtotal">{subtitle(result)}</div>}
      {flagList.length === 0 ? (
        <div className="empty">✅ No issues found in this category</div>
      ) : (
        flagList.map((x, i) => <FlagCard key={i} pa={x.pa} flag={x.flag} />)
      )}
    </section>
  );
}

function Scorecard({ result }: { result: AnalysisResult }) {
  const sorted = useMemo(
    () => [...result.products].sort((a, b) => a.score - b.score),
    [result],
  );
  const productList = useMemo(() => result.products.map((p) => p.product), [result]);
  const comp = useCompetitorPricing(productList);
  const [minConfidence, setMinConfidence] = useConfidenceThreshold();
  const deferredMinConfidence = useDeferredValue(minConfidence);
  // Build a key→original-index map so the competitor lookup matches
  const indexByPa = useMemo(() => {
    const m = new Map<ProductAnalysis, number>();
    result.products.forEach((pa, i) => m.set(pa, i));
    return m;
  }, [result]);

  const matchedAboveThreshold = useMemo(() => {
    if (comp.status !== "success") return 0;
    return Object.values(comp.matches).filter((m) => m.confidence >= deferredMinConfidence).length;
  }, [comp, deferredMinConfidence]);

  return (
    <section>
      <h2>📋 Section 7: Full Product Scorecard</h2>
      <div className="section-summary" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span>
          Sorted worst-first. {sorted.length} products analysed.
          {comp.status === "success" && (
            <> · <strong>{matchedAboveThreshold}</strong> matched
              {minConfidence > 0 ? ` at ≥${Math.round(minConfidence * 100)}% confidence` : " to competitor pricing"}.</>
          )}
          {comp.status === "loading" && <> · Loading competitor pricing…</>}
        </span>
        <span className="no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <label htmlFor="scorecard-conf" style={{ fontSize: 12 }}>Min confidence:</label>
          <select
            id="scorecard-conf"
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            style={{ fontSize: 12, padding: "2px 6px", border: "1px solid var(--grey-200)", borderRadius: 4, background: "#fff" }}
          >
            {CONFIDENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </span>
      </div>
      <table className="scorecard">
        <thead>
          <tr>
            <th>Product</th>
            <th>SOH</th>
            <th>Sell $</th>
            <th>Comp Avg $</th>
            <th>vs Market</th>
            <th>Margin %</th>
            <th>Margin Gap</th>
            <th>Match</th>
            <th>Conf.</th>
            <th>GP $</th>
            <th>Qty Sold</th>
            <th>Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pa, i) => {
            const idx = indexByPa.get(pa);
            const rawMatch = idx !== undefined ? comp.matches[productKey(pa.product, idx)] : undefined;
            const m = rawMatch && rawMatch.confidence >= deferredMinConfidence ? rawMatch : undefined;
            const our = pa.product.sellPrice;
            const cost = pa.product.ws1Cost > 0 ? pa.product.ws1Cost : pa.product.avgCost;
            const priceDelta = m && our > 0 ? ((our - m.avg_price) / m.avg_price) * 100 : null;
            const compMargin = m && cost > 0 && m.avg_price > 0 ? ((m.avg_price - cost) / m.avg_price) * 100 : null;
            const marginGap = compMargin !== null ? pa.product.marginPct - compMargin : null;
            return (
              <tr key={i}>
                <td>{pa.product.stockName || "(no name)"}</td>
                <td className="num">{pa.product.soh}</td>
                <td className="num">{fmtAUD(our)}</td>
                <td className="num">{m ? fmtAUD(m.avg_price) : "—"}</td>
                <td className="num" style={{
                  color: priceDelta === null ? undefined : priceDelta > 2 ? "#c0392b" : priceDelta < -2 ? "#27ae60" : undefined,
                  fontWeight: priceDelta !== null && Math.abs(priceDelta) > 2 ? 600 : undefined,
                }}>
                  {priceDelta === null ? "—" : `${priceDelta > 0 ? "+" : ""}${priceDelta.toFixed(1)}%`}
                </td>
                <td className="num">{fmtPct(pa.product.marginPct)}</td>
                <td className="num" style={{
                  color: marginGap === null ? undefined : marginGap > 0 ? "#27ae60" : marginGap < 0 ? "#c0392b" : undefined,
                  fontWeight: marginGap !== null && Math.abs(marginGap) > 2 ? 600 : undefined,
                }}>
                  {marginGap === null ? "—" : `${marginGap > 0 ? "+" : ""}${marginGap.toFixed(1)}%`}
                </td>
                <td style={{ fontSize: 12 }}>
                  {m ? (m.match_method === "pde" ? "APN" : m.match_method === "name_exact" ? "Exact" : "Fuzzy") : "—"}
                </td>
                <td className="num" style={{
                  color: !m ? undefined : m.confidence >= 0.95 ? "#27ae60" : m.confidence >= 0.75 ? "#16a34a" : m.confidence >= 0.6 ? "#d97706" : "#c0392b",
                  fontWeight: m && m.confidence < 0.75 ? 600 : undefined,
                }}>
                  {m ? `${Math.round(m.confidence * 100)}%` : "—"}
                </td>
                <td className="num">{fmtAUD(pa.product.salesGP)}</td>
                <td className="num">{pa.product.qtySold}</td>
                <td className="num">{pa.score}</td>
                <td>
                  <span className={`score-pill ${bandClass(pa.scoreBand)}`}>
                    {pa.scoreBand}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function StockAnalysisReport({
  result,
  onReset,
}: {
  result: AnalysisResult;
  onReset?: () => void;
}) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [deeperOpen, setDeeperOpen] = useState(false);

  const onPrint = () => window.print();

  const onDownloadHtml = () => {
    if (!reportRef.current) return;
    const inner = reportRef.current.innerHTML;
    const date = result.generatedAt.toISOString().slice(0, 10);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FOS Stock Analysis Report — ${date}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="fos-report">${inner}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FOS_Stock_Analysis_${date}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const t = result.totals;

  return (
    <div className="fos-report">
      <style>{REPORT_CSS}</style>
      <div className="tabbar no-print">
        <button className="tab" onClick={() => scrollToId("summary")}>📊 Summary</button>
        <button className="tab" onClick={() => scrollToId("sections")}>🚦 Flags</button>
        <button className="tab" onClick={() => scrollToId("scorecard")}>📋 Scorecard</button>
        <button className="tab deeper" onClick={() => setDeeperOpen(true)}>
          🔍 Deeper Dive Analysis
        </button>
      </div>
      <div className="container" ref={reportRef}>
        <div className="header-card">
          <h1>FOS Stock Analysis Report</h1>
          <div className="meta">
            <div><strong>Blackshaws Road Pharmacy</strong></div>
            <div>
              Generated {result.generatedAt.toLocaleString("en-AU")} ·
              {" "}Period {fmtDate(result.periodStart)} → {fmtDate(result.periodEnd)} ({result.periodDays} days)
            </div>
            <div>
              <strong>{t.productCount}</strong> products analysed ·
              {" "}<strong>{t.flagCount}</strong> flags raised
            </div>
          </div>
          <div className="toolbar no-print">
            <button className="btn" onClick={onPrint}>🖨️ Print Report</button>
            <button className="btn" onClick={onDownloadHtml}>📥 Save as HTML</button>
            {onReset && (
              <button className="btn ghost" onClick={onReset}>🔄 Analyse New File</button>
            )}
          </div>
        </div>

        <h2 id="summary">📊 Executive Summary</h2>
        <div className="kpi-grid">
          <div className="kpi"><div className="label">Total Stock Value</div><div className="value">{fmtAUD(t.stockValue)}</div></div>
          <div className="kpi"><div className="label">Total GP Earned</div><div className="value">{fmtAUD(t.salesGP)}</div></div>
          <div className="kpi"><div className="label">Total Revenue</div><div className="value">{fmtAUD(t.salesVal)}</div></div>
          <div className="kpi"><div className="label">Blended Margin</div><div className="value">{fmtPct(t.blendedMargin)}</div></div>
          <div className="kpi"><div className="label">Products w/ Zero Sales</div><div className="value">{t.zeroSalesCount}</div></div>
          <div className="kpi"><div className="label">Currently Out of Stock</div><div className="value">{t.outOfStockCount}</div></div>
        </div>

        <div id="sections">
          {SECTIONS.map((s) => (
            <Section
              key={s.num}
              result={result}
              num={s.num}
              title={s.title}
              emoji={s.emoji}
              subtitle={s.subtitle}
            />
          ))}
        </div>

        <div id="scorecard">
          <Scorecard result={result} />
        </div>

        <div className="footer-note">
          Generated by FOS Stock Report Cleaner — all analysis performed in your browser.
        </div>
      </div>
      {deeperOpen && (
        <Suspense fallback={null}>
          <DeeperDiveModal open={deeperOpen} onOpenChange={setDeeperOpen} result={result} />
        </Suspense>
      )}
    </div>
  );
}
