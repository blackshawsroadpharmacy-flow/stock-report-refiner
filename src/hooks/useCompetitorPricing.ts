import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/lib/fos-analyzer";

export type CompetitorMatch = {
  match_count: number;
  vendor_count: number;
  min_price: number;
  avg_price: number;
  max_price: number;
  median_price: number;
  example_vendor: string | null;
  example_name: string | null;
  match_method: "pde" | "name_exact" | "name_fuzzy";
  confidence: number;
};

export type CompetitorMap = Record<string, CompetitorMatch>;

export type MethodBreakdown = {
  pde: number;
  name_exact: number;
  name_fuzzy: number;
};

export type CompetitorState = {
  status: "idle" | "loading" | "success" | "error" | "cancelled";
  matches: CompetitorMap;
  error?: string;
  matchedCount: number;
  totalCount: number;
  processedCount: number;
  processedKeys: Set<string>;
  methodCounts: MethodBreakdown;
  elapsedMs: number;
  msPerProduct: number;
  lastChunkMs: number;
  lastChunkSize: number;
  lastChunkMsPerProduct: number;
};

export type CompetitorPricingResult = CompetitorState & {
  cancel: () => void;
};

/** Build the canonical row key (must match how the UI looks rows up). */
export const productKey = (p: Product, idx: number) =>
  `${idx}|${(p.apn || "").trim()}|${(p.stockName || "").trim()}`;

export function useCompetitorPricing(products: Product[] | null): CompetitorPricingResult {
  const [state, setState] = useState<CompetitorState>({
    status: "idle",
    matches: {},
    matchedCount: 0,
    totalCount: 0,
    processedCount: 0,
    processedKeys: new Set(),
  });
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const cancel = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
    setState((s) =>
      s.status === "loading"
        ? { ...s, status: "cancelled" }
        : s,
    );
  }, []);

  useEffect(() => {
    if (!products || products.length === 0) {
      setState({ status: "idle", matches: {}, matchedCount: 0, totalCount: 0, processedCount: 0, processedKeys: new Set() });
      return;
    }
    const token = { cancelled: false };
    cancelRef.current = token;
    setState({ status: "loading", matches: {}, matchedCount: 0, totalCount: products.length, processedCount: 0, processedKeys: new Set() });

    (async () => {
      try {
        const queries = products.map((p, i) => ({
          key: productKey(p, i),
          apn: p.apn || "",
          pde: p.pde || "",
          name: p.stockName || "",
        }));

        const CHUNK = 300;
        const CONCURRENCY = 5;
        const matches: CompetitorMap = {};
        const processedKeys = new Set<string>();
        const slices: typeof queries[] = [];
        for (let i = 0; i < queries.length; i += CHUNK) slices.push(queries.slice(i, i + CHUNK));

        let nextIdx = 0;
        let processed = 0;

        const runOne = async () => {
          while (true) {
            if (token.cancelled) return;
            const idx = nextIdx++;
            if (idx >= slices.length) return;
            const slice = slices[idx];
            const { data, error } = await supabase.rpc("match_competitor_prices", {
              queries: slice as any,
            });
            if (token.cancelled) return;
            if (error) throw error;
            for (const row of (data as any[]) ?? []) {
              matches[row.key] = {
                match_count: Number(row.match_count) || 0,
                vendor_count: Number(row.vendor_count) || 0,
                min_price: Number(row.min_price),
                avg_price: Number(row.avg_price),
                max_price: Number(row.max_price),
                median_price: Number(row.median_price),
                example_vendor: row.example_vendor,
                example_name: row.example_name,
                match_method: row.match_method,
                confidence: row.confidence == null ? 0 : Number(row.confidence),
              };
            }
            for (const q of slice) processedKeys.add(q.key);
            processed += slice.length;
            if (!token.cancelled) {
              setState((s) => ({
                ...s,
                status: "loading",
                matches: { ...matches },
                matchedCount: Object.keys(matches).length,
                processedCount: processed,
                totalCount: products.length,
                processedKeys: new Set(processedKeys),
              }));
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, runOne));
        if (token.cancelled) {
          setState({
            status: "cancelled",
            matches,
            matchedCount: Object.keys(matches).length,
            totalCount: products.length,
            processedCount: processed,
            processedKeys,
          });
          return;
        }
        setState({
          status: "success",
          matches,
          matchedCount: Object.keys(matches).length,
          totalCount: products.length,
          processedCount: products.length,
          processedKeys,
        });
      } catch (e: any) {
        if (token.cancelled) return;
        setState({
          status: "error",
          matches: {},
          error: e?.message || "Failed to load competitor pricing",
          matchedCount: 0,
          totalCount: products.length,
          processedCount: 0,
          processedKeys: new Set(),
        });
      }
    })();

    return () => {
      token.cancelled = true;
    };
  }, [products]);

  return { ...state, cancel };
}
