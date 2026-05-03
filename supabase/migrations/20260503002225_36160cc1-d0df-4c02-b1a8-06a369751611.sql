CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.competitor_prices (
  id BIGSERIAL PRIMARY KEY,
  barcode_raw TEXT,
  product_name TEXT NOT NULL,
  product_name_normalized TEXT NOT NULL,
  vendor TEXT,
  product_type TEXT,
  pde TEXT,
  sell_price NUMERIC(10,2),
  rrp NUMERIC(10,2),
  variant TEXT,
  source TEXT NOT NULL DEFAULT 'mega_master_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_prices_name_norm ON public.competitor_prices (product_name_normalized);
CREATE INDEX idx_competitor_prices_pde ON public.competitor_prices (pde) WHERE pde IS NOT NULL;
CREATE INDEX idx_competitor_prices_vendor ON public.competitor_prices (vendor);
CREATE INDEX idx_competitor_prices_name_trgm ON public.competitor_prices USING gin (product_name_normalized gin_trgm_ops);

ALTER TABLE public.competitor_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read competitor prices"
  ON public.competitor_prices FOR SELECT USING (true);
CREATE POLICY "Authenticated insert competitor prices"
  ON public.competitor_prices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update competitor prices"
  ON public.competitor_prices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete competitor prices"
  ON public.competitor_prices FOR DELETE TO authenticated USING (true);