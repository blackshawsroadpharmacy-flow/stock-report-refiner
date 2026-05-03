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
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH q AS (
  SELECT ord::integer AS ord,
         elem->>'key' AS key,
         nullif(trim(coalesce(elem->>'apn','')), '') AS apn,
         nullif(trim(coalesce(elem->>'pde','')), '') AS pde,
         trim(public.normalize_product_name(coalesce(elem->>'name',''))) AS norm_name,
         nullif(public.normalize_competitor_code(nullif(trim(coalesce(elem->>'apn','')), '')), '') AS apn_digits
  FROM jsonb_array_elements(queries) WITH ORDINALITY AS t(elem, ord)
), usable AS (
  SELECT *
  FROM q
  WHERE norm_name <> '' OR apn IS NOT NULL OR pde IS NOT NULL
), code_hits AS (
  SELECT DISTINCT ON (u.ord, cp.id)
         u.ord, u.key, cp.id, cp.vendor, cp.product_name, cp.sell_price
  FROM usable u
  JOIN public.competitor_prices cp
    ON cp.sell_price IS NOT NULL
   AND u.pde IS NOT NULL
   AND length(u.pde) >= 3
   AND cp.pde = u.pde

  UNION

  SELECT DISTINCT ON (u.ord, cp.id)
         u.ord, u.key, cp.id, cp.vendor, cp.product_name, cp.sell_price
  FROM usable u
  JOIN public.competitor_prices cp
    ON cp.sell_price IS NOT NULL
   AND u.apn IS NOT NULL
   AND length(u.apn) >= 4
   AND cp.pde = u.apn

  UNION

  SELECT DISTINCT ON (u.ord, cp.id)
         u.ord, u.key, cp.id, cp.vendor, cp.product_name, cp.sell_price
  FROM usable u
  JOIN public.competitor_prices cp
    ON cp.sell_price IS NOT NULL
   AND u.apn IS NOT NULL
   AND length(u.apn) >= 4
   AND cp.barcode_raw = u.apn

  UNION

  SELECT DISTINCT ON (u.ord, cp.id)
         u.ord, u.key, cp.id, cp.vendor, cp.product_name, cp.sell_price
  FROM usable u
  JOIN public.competitor_prices cp
    ON cp.sell_price IS NOT NULL
   AND u.apn_digits IS NOT NULL
   AND length(u.apn_digits) >= 4
   AND public.normalize_competitor_code(cp.barcode_raw) = u.apn_digits
), code_agg AS (
  SELECT h.ord,
         h.key,
         count(*)::integer AS match_count,
         count(distinct h.vendor)::integer AS vendor_count,
         min(h.sell_price) AS min_price,
         round(avg(h.sell_price)::numeric, 2) AS avg_price,
         max(h.sell_price) AS max_price,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h.sell_price))::numeric, 2) AS median_price,
         (array_agg(h.vendor ORDER BY h.sell_price))[1] AS example_vendor,
         (array_agg(h.product_name ORDER BY h.sell_price))[1] AS example_name,
         'pde'::text AS match_method,
         1.0::numeric AS confidence
  FROM code_hits h
  GROUP BY h.ord, h.key
), exact_hits AS (
  SELECT u.ord, u.key, cp.id, cp.vendor, cp.product_name, cp.sell_price
  FROM usable u
  JOIN public.competitor_prices cp
    ON cp.sell_price IS NOT NULL
   AND u.norm_name <> ''
   AND cp.product_name_normalized = u.norm_name
  WHERE NOT EXISTS (SELECT 1 FROM code_agg c WHERE c.ord = u.ord)
), exact_agg AS (
  SELECT h.ord,
         h.key,
         count(*)::integer AS match_count,
         count(distinct h.vendor)::integer AS vendor_count,
         min(h.sell_price) AS min_price,
         round(avg(h.sell_price)::numeric, 2) AS avg_price,
         max(h.sell_price) AS max_price,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h.sell_price))::numeric, 2) AS median_price,
         (array_agg(h.vendor ORDER BY h.sell_price))[1] AS example_vendor,
         (array_agg(h.product_name ORDER BY h.sell_price))[1] AS example_name,
         'name_exact'::text AS match_method,
         1.0::numeric AS confidence
  FROM exact_hits h
  GROUP BY h.ord, h.key
), fuzzy_hits AS (
  SELECT u.ord,
         u.key,
         f.vendor,
         f.product_name,
         f.sell_price,
         f.sim
  FROM usable u
  CROSS JOIN LATERAL (
    SELECT cp.vendor,
           cp.product_name,
           cp.sell_price,
           similarity(cp.product_name_normalized, u.norm_name) AS sim
    FROM public.competitor_prices cp
    WHERE cp.sell_price IS NOT NULL
      AND cp.product_name_normalized % u.norm_name
    ORDER BY similarity(cp.product_name_normalized, u.norm_name) DESC
    LIMIT 10
  ) f
  WHERE u.apn IS NULL
    AND u.pde IS NULL
    AND length(u.norm_name) >= 4
    AND f.sim >= 0.55
    AND NOT EXISTS (SELECT 1 FROM code_agg c WHERE c.ord = u.ord)
    AND NOT EXISTS (SELECT 1 FROM exact_agg e WHERE e.ord = u.ord)
), fuzzy_agg AS (
  SELECT h.ord,
         h.key,
         count(*)::integer AS match_count,
         count(distinct h.vendor)::integer AS vendor_count,
         min(h.sell_price) AS min_price,
         round(avg(h.sell_price)::numeric, 2) AS avg_price,
         max(h.sell_price) AS max_price,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h.sell_price))::numeric, 2) AS median_price,
         (array_agg(h.vendor ORDER BY h.sim DESC))[1] AS example_vendor,
         (array_agg(h.product_name ORDER BY h.sim DESC))[1] AS example_name,
         'name_fuzzy'::text AS match_method,
         round(avg(h.sim)::numeric, 3) AS confidence
  FROM fuzzy_hits h
  GROUP BY h.ord, h.key
)
SELECT c.key,
       c.match_count,
       c.vendor_count,
       c.min_price,
       c.avg_price,
       c.max_price,
       c.median_price,
       c.example_vendor,
       c.example_name,
       c.match_method,
       c.confidence
FROM code_agg c

UNION ALL

SELECT e.key,
       e.match_count,
       e.vendor_count,
       e.min_price,
       e.avg_price,
       e.max_price,
       e.median_price,
       e.example_vendor,
       e.example_name,
       e.match_method,
       e.confidence
FROM exact_agg e

UNION ALL

SELECT f.key,
       f.match_count,
       f.vendor_count,
       f.min_price,
       f.avg_price,
       f.max_price,
       f.median_price,
       f.example_vendor,
       f.example_name,
       f.match_method,
       f.confidence
FROM fuzzy_agg f
ORDER BY 1;
$function$;