import { useEffect, useState } from "react";

const KEY = "fos.competitorConfidenceThreshold";
const DEFAULT = 0; // show all by default

export const CONFIDENCE_OPTIONS = [
  { value: 0, label: "All matches" },
  { value: 0.6, label: "≥ 60%" },
  { value: 0.75, label: "≥ 75%" },
  { value: 0.85, label: "≥ 85%" },
  { value: 0.95, label: "≥ 95% (exact only)" },
];

export function useConfidenceThreshold() {
  const [threshold, setThreshold] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT;
    const raw = window.localStorage.getItem(KEY);
    const n = raw === null ? DEFAULT : Number(raw);
    return Number.isFinite(n) ? n : DEFAULT;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, String(threshold));
    } catch {
      /* ignore */
    }
    // Broadcast so multiple components stay in sync within the same tab
    window.dispatchEvent(new CustomEvent("fos:confidence-threshold", { detail: threshold }));
  }, [threshold]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent<number>).detail;
      if (typeof v === "number" && v !== threshold) setThreshold(v);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue !== null) {
        const n = Number(e.newValue);
        if (Number.isFinite(n) && n !== threshold) setThreshold(n);
      }
    };
    window.addEventListener("fos:confidence-threshold", onChange as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("fos:confidence-threshold", onChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [threshold]);

  return [threshold, setThreshold] as const;
}
