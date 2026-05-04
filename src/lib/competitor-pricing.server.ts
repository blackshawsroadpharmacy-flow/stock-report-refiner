import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CompetitorQuery = {
  key: string;
  apn?: string;
  pde?: string;
  name?: string;
};

export async function matchCompetitorPricesServer(queries: CompetitorQuery[]) {
  const { data, error } = await supabaseAdmin.rpc("match_competitor_prices", {
    queries: queries as any,
  });
  if (error) throw new Error(error.message);
  return (data as any[]) ?? [];
}

export async function listCompetitorListingsServer(
  queries: CompetitorQuery[],
  maxPerProduct: number,
) {
  const { data, error } = await supabaseAdmin.rpc("list_competitor_listings", {
    queries: queries as any,
    max_per_product: maxPerProduct,
  });
  if (error) throw new Error(error.message);
  return (data as any[]) ?? [];
}