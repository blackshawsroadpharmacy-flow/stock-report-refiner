import { useEffect, useState } from "react";
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

export type CompetitorState = {
  status: "idle" | "loading" | "success" | "error";
  matches: CompetitorMap;
  error?: string;
  matchedCount: number;
  totalCount: number;
};

/** Build the canonical row key (must match how the UI looks rows up). */
export const productKey = (p: Product, idx: number) =>
  `${idx}|${(p.apn || "").trim()}|${(p.stockName || "").trim()}`;

export function useCompetitorPricing(products: Product[] | null): CompetitorState {
  const [state, setState] = useState<CompetitorState>({
    status: "idle",
    matches: {},
    matchedCount: 0,
    totalCount: 0,
  });

  useEffect(() => {
    if (!products || products.length === 0) {
      setState({ status: "idle", matches: {}, matchedCount: 0, totalCount: 0 });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", totalCount: products.length }));

    (async () => {
      try {
        const queries = products.map((p, i) => ({
          key: productKey(p, i),
          apn: p.apn || "",
          name: p.stockName || "",
        }));

        // Chunk to keep RPC payloads sane
        const CHUNK = 400;
        const matches: CompetitorMap = {};
        for (let i = 0; i < queries.length; i += CHUNK) {
          const slice = queries.slice(i, i + CHUNK);
          const { data, error } = await supabase.rpc("match_competitor_prices", {
            queries: slice as any,
          });
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
          if (cancelled) return;
        }
        if (cancelled) return;
        setState({
          status: "success",
          matches,
          matchedCount: Object.keys(matches).length,
          totalCount: products.length,
        });
      } catch (e: any) {
        if (cancelled) return;
        setState({
          status: "error",
          matches: {},
          error: e?.message || "Failed to load competitor pricing",
          matchedCount: 0,
          totalCount: products.length,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [products]);

  return state;
}
