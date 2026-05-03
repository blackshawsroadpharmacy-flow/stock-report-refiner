CREATE OR REPLACE FUNCTION public.list_competitor_listings(queries jsonb, max_per_product integer DEFAULT 50)
RETURNS TABLE(
  key text,
  match_method text,
  confidence numeric,
  vendor text,
  competitor_product_name text,
  pde text,
  variant text,
  sell_price numeric,
  rrp numeric,
  product_type text,
  source text,
  similarity numeric
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  q JSONB;
  q_key TEXT;
  q_apn TEXT;
  q_name TEXT;
  q_norm TEXT;
  found BOOLEAN;
BEGIN
  FOR q IN SELECT * FROM jsonb_array_elements(queries) LOOP
    q_key := q->>'key';
    q_apn := nullif(trim(coalesce(q->>'apn','')), '');
    q_name := coalesce(q->>'name','');
    q_norm := trim(public.normalize_product_name(q_name));
    found := false;

    IF q_norm = '' AND q_apn IS NULL THEN CONTINUE; END IF;

    -- Stage 1: APN
    IF q_apn IS NOT NULL AND length(q_apn) >= 4 THEN
      RETURN QUERY
      SELECT q_key, 'pde'::text, 1.0::numeric,
             cp.vendor, cp.product_name, cp.pde, cp.variant,
             cp.sell_price, cp.rrp, cp.product_type, cp.source,
             1.0::numeric
      FROM public.competitor_prices cp
      WHERE cp.pde = q_apn AND cp.sell_price IS NOT NULL
      ORDER BY cp.sell_price ASC
      LIMIT max_per_product;
      IF FOUND THEN found := true; END IF;
    END IF;

    -- Stage 2: exact normalized name
    IF NOT found AND q_norm <> '' THEN
      RETURN QUERY
      SELECT q_key, 'name_exact'::text, 1.0::numeric,
             cp.vendor, cp.product_name, cp.pde, cp.variant,
             cp.sell_price, cp.rrp, cp.product_type, cp.source,
             1.0::numeric
      FROM public.competitor_prices cp
      WHERE cp.product_name_normalized = q_norm AND cp.sell_price IS NOT NULL
      ORDER BY cp.sell_price ASC
      LIMIT max_per_product;
      IF FOUND THEN found := true; END IF;
    END IF;

    -- Stage 3: trigram fuzzy
    IF NOT found AND length(q_norm) >= 4 THEN
      RETURN QUERY
      WITH cand AS (
        SELECT cp.vendor, cp.product_name, cp.pde, cp.variant,
               cp.sell_price, cp.rrp, cp.product_type, cp.source,
               similarity(cp.product_name_normalized, q_norm) AS sim
        FROM public.competitor_prices cp
        WHERE cp.sell_price IS NOT NULL
          AND cp.product_name_normalized % q_norm
        ORDER BY sim DESC
        LIMIT max_per_product * 2
      )
      SELECT q_key, 'name_fuzzy'::text, round(c.sim, 3),
             c.vendor, c.product_name, c.pde, c.variant,
             c.sell_price, c.rrp, c.product_type, c.source,
             round(c.sim, 3)
      FROM cand c
      WHERE c.sim >= 0.55
      ORDER BY c.sim DESC, c.sell_price ASC
      LIMIT max_per_product;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_competitor_listings(jsonb, integer) TO anon, authenticated;