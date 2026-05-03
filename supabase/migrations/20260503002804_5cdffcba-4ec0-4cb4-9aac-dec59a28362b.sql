DROP FUNCTION IF EXISTS public.match_competitor_prices(jsonb);

CREATE FUNCTION public.match_competitor_prices(queries jsonb)
RETURNS TABLE(
  key text,
  match_count integer,
  vendor_count integer,
  min_price numeric,
  avg_price numeric,
  max_price numeric,
  median_price numeric,
  example_vendor text,
  example_name text,
  match_method text,
  confidence numeric
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
  m RECORD;
  method TEXT;
  conf NUMERIC;
BEGIN
  FOR q IN SELECT * FROM jsonb_array_elements(queries) LOOP
    q_key := q->>'key';
    q_apn := nullif(trim(coalesce(q->>'apn','')), '');
    q_name := coalesce(q->>'name','');
    q_norm := trim(public.normalize_product_name(q_name));

    IF q_norm = '' AND q_apn IS NULL THEN CONTINUE; END IF;

    method := NULL; conf := NULL;

    IF q_apn IS NOT NULL AND length(q_apn) >= 4 THEN
      SELECT count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices
      WHERE pde = q_apn AND sell_price IS NOT NULL;
      IF m.c > 0 THEN method := 'pde'; conf := 1.0; END IF;
    END IF;

    IF method IS NULL AND q_norm <> '' THEN
      SELECT count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices
      WHERE product_name_normalized = q_norm AND sell_price IS NOT NULL;
      IF m.c > 0 THEN method := 'name_exact'; conf := 1.0; END IF;
    END IF;

    IF method IS NULL AND length(q_norm) >= 4 THEN
      WITH cand AS (
        SELECT vendor, product_name, sell_price,
               similarity(product_name_normalized, q_norm) AS sim
        FROM public.competitor_prices
        WHERE sell_price IS NOT NULL AND product_name_normalized % q_norm
        ORDER BY sim DESC LIMIT 10
      ), filt AS (SELECT * FROM cand WHERE sim >= 0.55)
      SELECT count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sim DESC))[1] AS ev,
        (array_agg(product_name ORDER BY sim DESC))[1] AS en,
        avg(sim)::numeric AS sim_avg
      INTO m FROM filt;
      IF m.c > 0 THEN method := 'name_fuzzy'; conf := round(m.sim_avg, 3); END IF;
    END IF;

    IF method IS NOT NULL THEN
      key := q_key; match_count := m.c; vendor_count := m.vc;
      min_price := m.mn; avg_price := round(m.av::numeric, 2);
      max_price := m.mx; median_price := round(m.med::numeric, 2);
      example_vendor := m.ev; example_name := m.en;
      match_method := method; confidence := conf;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_competitor_prices(jsonb) TO anon, authenticated;