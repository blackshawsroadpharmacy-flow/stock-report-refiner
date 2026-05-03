CREATE OR REPLACE FUNCTION public.normalize_competitor_code(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(coalesce(s, ''), '[^0-9]', '', 'g');
$$;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_barcode_raw
  ON public.competitor_prices (barcode_raw)
  WHERE barcode_raw IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_barcode_digits
  ON public.competitor_prices (public.normalize_competitor_code(barcode_raw))
  WHERE barcode_raw IS NOT NULL;

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
  q jsonb;
  q_key text;
  q_apn text;
  q_pde text;
  q_name text;
  q_norm text;
  q_apn_digits text;
  m record;
  method text;
  conf numeric;
BEGIN
  FOR q IN SELECT * FROM jsonb_array_elements(queries) LOOP
    q_key := q->>'key';
    q_apn := nullif(trim(coalesce(q->>'apn','')), '');
    q_pde := nullif(trim(coalesce(q->>'pde','')), '');
    q_name := coalesce(q->>'name','');
    q_norm := trim(public.normalize_product_name(q_name));
    q_apn_digits := nullif(public.normalize_competitor_code(q_apn), '');

    IF q_norm = '' AND q_apn IS NULL AND q_pde IS NULL THEN CONTINUE; END IF;

    method := NULL; conf := NULL;

    IF (q_apn IS NOT NULL AND length(q_apn) >= 4) OR (q_pde IS NOT NULL AND length(q_pde) >= 3) THEN
      SELECT count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices cp
      WHERE cp.sell_price IS NOT NULL
        AND (
          (q_pde IS NOT NULL AND cp.pde = q_pde)
          OR (q_apn IS NOT NULL AND (cp.pde = q_apn OR cp.barcode_raw = q_apn))
          OR (q_apn_digits IS NOT NULL AND public.normalize_competitor_code(cp.barcode_raw) = q_apn_digits)
        );
      IF m.c > 0 THEN method := 'pde'; conf := 1.0; END IF;
    END IF;

    IF method IS NULL AND q_norm <> '' THEN
      SELECT count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices cp
      WHERE cp.product_name_normalized = q_norm AND cp.sell_price IS NOT NULL;
      IF m.c > 0 THEN method := 'name_exact'; conf := 1.0; END IF;
    END IF;

    IF method IS NULL AND q_apn IS NULL AND q_pde IS NULL AND length(q_norm) >= 4 THEN
      WITH cand AS (
        SELECT cp.vendor, cp.product_name, cp.sell_price,
               similarity(cp.product_name_normalized, q_norm) AS sim
        FROM public.competitor_prices cp
        WHERE cp.sell_price IS NOT NULL AND cp.product_name_normalized % q_norm
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