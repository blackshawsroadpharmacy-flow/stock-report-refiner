import { useCallback, useEffect, useState } from "react";
import {
  buildStrategicAnalystReport,
  type CleanedDataset,
  type StrategicReport,
} from "@/lib/deeperDiveUtils";

export type AnalystState = "idle" | "loading" | "success" | "error";

export function useStrategicAnalyst(ds: CleanedDataset | null, periodDays: number) {
  const [state, setState] = useState<AnalystState>("idle");
  const [report, setReport] = useState<StrategicReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    if (!ds) return;
    setState("loading");
    setError(null);
    // Defer to next tick so the modal can paint the loading state first.
    setTimeout(() => {
      try {
        const r = buildStrategicAnalystReport(ds, periodDays);
        setReport(r);
        setState("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setState("error");
      }
    }, 50);
  }, [ds, periodDays]);

  useEffect(() => {
    if (ds && state === "idle") run();
  }, [ds, state, run]);

  return { state, report, error, retry: run };
}
