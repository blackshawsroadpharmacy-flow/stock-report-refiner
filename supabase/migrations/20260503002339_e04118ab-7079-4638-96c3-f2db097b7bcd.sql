-- Helper: normalize a product name the same way the loader did
CREATE OR REPLACE FUNCTION public.normalize_product_name(s TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(regexp_replace(lower(coalesce(s,'')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g');
$$;

-- Match function: takes JSON array of { key, apn, name } and returns aggregates
CREATE OR REPLACE FUNCTION public.match_competitor_prices(queries JSONB)
RETURNS TABLE (
  key TEXT,
  match_count INT,
  vendor_count INT,
  min_price NUMERIC,
  avg_price NUMERIC,
  max_price NUMERIC,
  median_price NUMERIC,
  example_vendor TEXT,
  example_name TEXT,
  match_method TEXT
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  q JSONB;
  q_key TEXT;
  q_apn TEXT;
  q_name TEXT;
  q_norm TEXT;
  m RECORD;
  method TEXT;
BEGIN
  FOR q IN SELECT * FROM jsonb_array_elements(queries) LOOP
    q_key := q->>'key';
    q_apn := nullif(trim(coalesce(q->>'apn','')), '');
    q_name := coalesce(q->>'name','');
    q_norm := trim(public.normalize_product_name(q_name));

    IF q_norm = '' AND q_apn IS NULL THEN
      CONTINUE;
    END IF;

    -- 1. Try exact PDE/APN match (only useful for the small subset where barcode_raw isn't corrupted)
    method := NULL;
    IF q_apn IS NOT NULL AND length(q_apn) >= 4 THEN
      SELECT
        count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices
      WHERE pde = q_apn AND sell_price IS NOT NULL;

      IF m.c > 0 THEN
        method := 'pde';
      END IF;
    END IF;

    -- 2. Fallback: exact normalized name
    IF method IS NULL AND q_norm <> '' THEN
      SELECT
        count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sell_price))[1] AS ev,
        (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices
      WHERE product_name_normalized = q_norm AND sell_price IS NOT NULL;

      IF m.c > 0 THEN
        method := 'name_exact';
      END IF;
    END IF;

    -- 3. Fallback: trigram fuzzy match (similarity >= 0.55), top 10 candidates
    IF method IS NULL AND length(q_norm) >= 4 THEN
      WITH cand AS (
        SELECT vendor, product_name, sell_price,
               similarity(product_name_normalized, q_norm) AS sim
        FROM public.competitor_prices
        WHERE sell_price IS NOT NULL
          AND product_name_normalized % q_norm
        ORDER BY sim DESC
        LIMIT 10
      )
      SELECT
        count(*)::int AS c, count(distinct vendor)::int AS vc,
        min(sell_price) AS mn, avg(sell_price) AS av, max(sell_price) AS mx,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
        (array_agg(vendor ORDER BY sim DESC))[1] AS ev,
        (array_agg(product_name ORDER BY sim DESC))[1] AS en
      INTO m
      FROM cand
      WHERE sim >= 0.55;

      IF m.c > 0 THEN
        method := 'name_fuzzy';
      END IF;
    END IF;

    IF method IS NOT NULL THEN
      key := q_key;
      match_count := m.c;
      vendor_count := m.vc;
      min_price := m.mn;
      avg_price := round(m.av::numeric, 2);
      max_price := m.mx;
      median_price := round(m.med::numeric, 2);
      example_vendor := m.ev;
      example_name := m.en;
      match_method := method;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_competitor_prices(JSONB) TO anon, authenticated;