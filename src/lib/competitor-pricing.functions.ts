import { createServerFn } from "@tanstack/react-start";
import {
  listCompetitorListingsServer,
  matchCompetitorPricesServer,
  type CompetitorQuery,
} from "./competitor-pricing.server";

function cleanQueries(input: unknown): CompetitorQuery[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((q) => q && typeof q === "object")
    .map((q: any) => ({
      key: String(q.key ?? "").slice(0, 500),
      apn: String(q.apn ?? "").slice(0, 80),
      pde: String(q.pde ?? "").slice(0, 80),
      name: String(q.name ?? "").slice(0, 500),
    }))
    .filter((q) => q.key.length > 0)
    .slice(0, 500);
}

export const matchCompetitorPrices = createServerFn({ method: "POST" })
  .inputValidator((input: { queries: unknown }) => ({
    queries: cleanQueries(input?.queries),
  }))
  .handler(async ({ data }) => matchCompetitorPricesServer(data.queries));

export const listCompetitorListings = createServerFn({ method: "POST" })
  .inputValidator((input: { queries: unknown; maxPerProduct?: number }) => ({
    queries: cleanQueries(input?.queries),
    maxPerProduct: Math.min(100, Math.max(1, Number(input?.maxPerProduct) || 50)),
  }))
  .handler(async ({ data }) =>
    listCompetitorListingsServer(data.queries, data.maxPerProduct),
  );