import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type CompetitorQuery = {
  key: string;
  apn?: string;
  pde?: string;
  name?: string;
};

function getServerSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    const missing = [
      !url ? "SUPABASE_URL" : null,
      !key ? "SUPABASE_PUBLISHABLE_KEY" : null,
    ].filter(Boolean);
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`,
    );
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function matchCompetitorPricesServer(queries: CompetitorQuery[]) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("match_competitor_prices", {
    queries: queries as any,
  });
  if (error) throw new Error(error.message);
  return (data as any[]) ?? [];
}

export async function listCompetitorListingsServer(
  queries: CompetitorQuery[],
  maxPerProduct: number,
) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("list_competitor_listings", {
    queries: queries as any,
    max_per_product: maxPerProduct,
  });
  if (error) throw new Error(error.message);
  return (data as any[]) ?? [];
}
