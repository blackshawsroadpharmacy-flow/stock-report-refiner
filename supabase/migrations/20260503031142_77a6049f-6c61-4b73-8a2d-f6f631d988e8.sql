-- Speed up competitor matching by avoiding broad OR scans across barcode/PDE columns.
-- The UI already sends APN + PDE + stock name; this function now checks each identifier
-- through separate index-friendly lookups before falling back to name matching.

CREATE INDEX IF NOT EXISTS idx_competitor_prices_pde_priced
ON public.competitor_prices (pde, sell_price)
WHERE pde IS NOT NULL AND sell_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_barcode_raw_priced
ON public.competitor_prices (barcode_raw, sell_price)
WHERE barcode_raw IS NOT NULL AND sell_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_barcode_digits_priced
ON public.competitor_prices (public.normalize_competitor_code(barcode_raw), sell_price)
WHERE barcode_raw IS NOT NULL AND sell_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competitor_prices_name_norm_priced
ON public.competitor_prices (product_name_normalized, sell_price)
WHERE sell_price IS NOT NULL;

CREATE OR REPLACE FUNCTION public.match_competitor_prices(queries jsonb)
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
LANGUAGE plpgsql
STABLE
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

    IF q_norm = '' AND q_apn IS NULL AND q_pde IS NULL THEN
      CONTINUE;
    END IF;

    method := NULL;
    conf := NULL;

    IF (q_apn IS NOT NULL AND length(q_apn) >= 4) OR (q_pde IS NOT NULL AND length(q_pde) >= 3) THEN
      WITH hits AS (
        SELECT cp.id, cp.vendor, cp.product_name, cp.sell_price
        FROM public.competitor_prices cp
        WHERE q_pde IS NOT NULL
          AND cp.pde = q_pde
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.sell_price
        FROM public.competitor_prices cp
        WHERE q_apn IS NOT NULL
          AND cp.pde = q_apn
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.sell_price
        FROM public.competitor_prices cp
        WHERE q_apn IS NOT NULL
          AND cp.barcode_raw = q_apn
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.sell_price
        FROM public.competitor_prices cp
        WHERE q_apn_digits IS NOT NULL
          AND public.normalize_competitor_code(cp.barcode_raw) = q_apn_digits
          AND cp.sell_price IS NOT NULL
      ), deduped AS (
        SELECT DISTINCT ON (id) id, vendor, product_name, sell_price
        FROM hits
        ORDER BY id
      )
      SELECT count(*)::int AS c,
             count(distinct vendor)::int AS vc,
             min(sell_price) AS mn,
             avg(sell_price) AS av,
             max(sell_price) AS mx,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
             (array_agg(vendor ORDER BY sell_price))[1] AS ev,
             (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM deduped;

      IF coalesce(m.c, 0) > 0 THEN
        method := 'pde';
        conf := 1.0;
      END IF;
    END IF;

    IF method IS NULL AND q_norm <> '' THEN
      SELECT count(*)::int AS c,
             count(distinct vendor)::int AS vc,
             min(sell_price) AS mn,
             avg(sell_price) AS av,
             max(sell_price) AS mx,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
             (array_agg(vendor ORDER BY sell_price))[1] AS ev,
             (array_agg(product_name ORDER BY sell_price))[1] AS en
      INTO m
      FROM public.competitor_prices cp
      WHERE cp.product_name_normalized = q_norm
        AND cp.sell_price IS NOT NULL;

      IF coalesce(m.c, 0) > 0 THEN
        method := 'name_exact';
        conf := 1.0;
      END IF;
    END IF;

    -- Expensive fuzzy matching is only attempted when no usable APN/PDE/barcode exists.
    IF method IS NULL AND q_apn IS NULL AND q_pde IS NULL AND length(q_norm) >= 4 THEN
      WITH cand AS (
        SELECT cp.vendor,
               cp.product_name,
               cp.sell_price,
               similarity(cp.product_name_normalized, q_norm) AS sim
        FROM public.competitor_prices cp
        WHERE cp.sell_price IS NOT NULL
          AND cp.product_name_normalized % q_norm
        ORDER BY sim DESC
        LIMIT 10
      ), filt AS (
        SELECT * FROM cand WHERE sim >= 0.55
      )
      SELECT count(*)::int AS c,
             count(distinct vendor)::int AS vc,
             min(sell_price) AS mn,
             avg(sell_price) AS av,
             max(sell_price) AS mx,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_price) AS med,
             (array_agg(vendor ORDER BY sim DESC))[1] AS ev,
             (array_agg(product_name ORDER BY sim DESC))[1] AS en,
             avg(sim)::numeric AS sim_avg
      INTO m
      FROM filt;

      IF coalesce(m.c, 0) > 0 THEN
        method := 'name_fuzzy';
        conf := round(m.sim_avg, 3);
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
      confidence := conf;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

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
LANGUAGE plpgsql
STABLE
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
  found boolean;
  emitted integer;
BEGIN
  FOR q IN SELECT * FROM jsonb_array_elements(queries) LOOP
    q_key := q->>'key';
    q_apn := nullif(trim(coalesce(q->>'apn','')), '');
    q_pde := nullif(trim(coalesce(q->>'pde','')), '');
    q_name := coalesce(q->>'name','');
    q_norm := trim(public.normalize_product_name(q_name));
    q_apn_digits := nullif(public.normalize_competitor_code(q_apn), '');
    found := false;

    IF q_norm = '' AND q_apn IS NULL AND q_pde IS NULL THEN
      CONTINUE;
    END IF;

    IF (q_apn IS NOT NULL AND length(q_apn) >= 4) OR (q_pde IS NOT NULL AND length(q_pde) >= 3) THEN
      RETURN QUERY
      WITH hits AS (
        SELECT cp.id, cp.vendor, cp.product_name, cp.pde, cp.variant,
               cp.sell_price, cp.rrp, cp.product_type, cp.source
        FROM public.competitor_prices cp
        WHERE q_pde IS NOT NULL
          AND cp.pde = q_pde
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.pde, cp.variant,
               cp.sell_price, cp.rrp, cp.product_type, cp.source
        FROM public.competitor_prices cp
        WHERE q_apn IS NOT NULL
          AND cp.pde = q_apn
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.pde, cp.variant,
               cp.sell_price, cp.rrp, cp.product_type, cp.source
        FROM public.competitor_prices cp
        WHERE q_apn IS NOT NULL
          AND cp.barcode_raw = q_apn
          AND cp.sell_price IS NOT NULL

        UNION ALL

        SELECT cp.id, cp.vendor, cp.product_name, cp.pde, cp.variant,
               cp.sell_price, cp.rrp, cp.product_type, cp.source
        FROM public.competitor_prices cp
        WHERE q_apn_digits IS NOT NULL
          AND public.normalize_competitor_code(cp.barcode_raw) = q_apn_digits
          AND cp.sell_price IS NOT NULL
      ), deduped AS (
        SELECT DISTINCT ON (id) id, vendor, product_name, pde, variant,
               sell_price, rrp, product_type, source
        FROM hits
        ORDER BY id
      )
      SELECT q_key,
             'pde'::text,
             1.0::numeric,
             d.vendor,
             d.product_name,
             d.pde,
             d.variant,
             d.sell_price,
             d.rrp,
             d.product_type,
             d.source,
             1.0::numeric
      FROM deduped d
      ORDER BY d.sell_price ASC
      LIMIT max_per_product;

      GET DIAGNOSTICS emitted = ROW_COUNT;
      IF emitted > 0 THEN
        found := true;
      END IF;
    END IF;

    IF NOT found AND q_norm <> '' THEN
      RETURN QUERY
      SELECT q_key,
             'name_exact'::text,
             1.0::numeric,
             cp.vendor,
             cp.product_name,
             cp.pde,
             cp.variant,
             cp.sell_price,
             cp.rrp,
             cp.product_type,
             cp.source,
             1.0::numeric
      FROM public.competitor_prices cp
      WHERE cp.product_name_normalized = q_norm
        AND cp.sell_price IS NOT NULL
      ORDER BY cp.sell_price ASC
      LIMIT max_per_product;

      GET DIAGNOSTICS emitted = ROW_COUNT;
      IF emitted > 0 THEN
        found := true;
      END IF;
    END IF;

    IF NOT found AND q_apn IS NULL AND q_pde IS NULL AND length(q_norm) >= 4 THEN
      RETURN QUERY
      WITH cand AS (
        SELECT cp.vendor,
               cp.product_name,
               cp.pde,
               cp.variant,
               cp.sell_price,
               cp.rrp,
               cp.product_type,
               cp.source,
               similarity(cp.product_name_normalized, q_norm)::numeric AS sim
        FROM public.competitor_prices cp
        WHERE cp.sell_price IS NOT NULL
          AND cp.product_name_normalized % q_norm
        ORDER BY similarity(cp.product_name_normalized, q_norm) DESC
        LIMIT max_per_product * 2
      )
      SELECT q_key,
             'name_fuzzy'::text,
             round(c.sim, 3),
             c.vendor,
             c.product_name,
             c.pde,
             c.variant,
             c.sell_price,
             c.rrp,
             c.product_type,
             c.source,
             round(c.sim, 3)
      FROM cand c
      WHERE c.sim >= 0.55
      ORDER BY c.sim DESC, c.sell_price ASC
      LIMIT max_per_product;
    END IF;
  END LOOP;
END;
$function$;