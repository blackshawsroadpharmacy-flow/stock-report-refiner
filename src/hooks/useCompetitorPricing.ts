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

const EMPTY_METHODS: MethodBreakdown = { pde: 0, name_exact: 0, name_fuzzy: 0 };

const idleState = (): CompetitorState => ({
  status: "idle",
  matches: {},
  matchedCount: 0,
  totalCount: 0,
  processedCount: 0,
  processedKeys: new Set(),
  methodCounts: { ...EMPTY_METHODS },
  elapsedMs: 0,
  msPerProduct: 0,
  lastChunkMs: 0,
  lastChunkSize: 0,
  lastChunkMsPerProduct: 0,
});

export function useCompetitorPricing(products: Product[] | null): CompetitorPricingResult {
  const [state, setState] = useState<CompetitorState>(idleState);
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
      setState(idleState());
      return;
    }
    const token = { cancelled: false };
    cancelRef.current = token;
    setState({ ...idleState(), status: "loading", totalCount: products.length });

    const startedAt = performance.now();

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
        const methodCounts: MethodBreakdown = { ...EMPTY_METHODS };
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
            const chunkStart = performance.now();
            const { data, error } = await supabase.rpc("match_competitor_prices", {
              queries: slice as any,
            });
            const chunkMs = performance.now() - chunkStart;
            if (token.cancelled) return;
            if (error) throw error;
            for (const row of (data as any[]) ?? []) {
              const method = row.match_method as CompetitorMatch["match_method"];
              matches[row.key] = {
                match_count: Number(row.match_count) || 0,
                vendor_count: Number(row.vendor_count) || 0,
                min_price: Number(row.min_price),
                avg_price: Number(row.avg_price),
                max_price: Number(row.max_price),
                median_price: Number(row.median_price),
                example_vendor: row.example_vendor,
                example_name: row.example_name,
                match_method: method,
                confidence: row.confidence == null ? 0 : Number(row.confidence),
              };
              if (method && method in methodCounts) methodCounts[method] += 1;
            }
            for (const q of slice) processedKeys.add(q.key);
            processed += slice.length;
            const elapsed = performance.now() - startedAt;
            if (!token.cancelled) {
              setState((s) => ({
                ...s,
                status: "loading",
                matches: { ...matches },
                matchedCount: Object.keys(matches).length,
                processedCount: processed,
                totalCount: products.length,
                processedKeys: new Set(processedKeys),
                methodCounts: { ...methodCounts },
                elapsedMs: elapsed,
                msPerProduct: processed > 0 ? elapsed / processed : 0,
                lastChunkMs: chunkMs,
                lastChunkSize: slice.length,
                lastChunkMsPerProduct: slice.length > 0 ? chunkMs / slice.length : 0,
              }));
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, runOne));
        const elapsed = performance.now() - startedAt;
        if (token.cancelled) {
          setState((s) => ({
            ...s,
            status: "cancelled",
            matches,
            matchedCount: Object.keys(matches).length,
            totalCount: products.length,
            processedCount: processed,
            processedKeys,
            methodCounts: { ...methodCounts },
            elapsedMs: elapsed,
            msPerProduct: processed > 0 ? elapsed / processed : 0,
          }));
          return;
        }
        setState((s) => ({
          ...s,
          status: "success",
          matches,
          matchedCount: Object.keys(matches).length,
          totalCount: products.length,
          processedCount: products.length,
          processedKeys,
          methodCounts: { ...methodCounts },
          elapsedMs: elapsed,
          msPerProduct: products.length > 0 ? elapsed / products.length : 0,
        }));
      } catch (e: any) {
        if (token.cancelled) return;
        setState({
          ...idleState(),
          status: "error",
          error: e?.message || "Failed to load competitor pricing",
          totalCount: products.length,
        });
      }
    })();

    return () => {
      token.cancelled = true;
    };
  }, [products]);

  return { ...state, cancel };
}

