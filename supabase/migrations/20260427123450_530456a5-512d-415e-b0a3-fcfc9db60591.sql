-- Market listings (catalog-linked real listings)
CREATE TABLE public.market_listings (
  id BIGINT PRIMARY KEY,
  car_variant_id INTEGER NOT NULL,
  source_name TEXT,
  source_listing_id TEXT,
  title TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  model_year INTEGER,
  mileage_km INTEGER,
  city TEXT,
  district TEXT,
  seller_type TEXT,
  painted_parts_count INTEGER,
  changed_parts_count INTEGER,
  accident_record_amount NUMERIC,
  first_registration_date DATE,
  listing_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_listings_variant ON public.market_listings(car_variant_id);
CREATE INDEX idx_market_listings_active ON public.market_listings(is_active);

ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read market listings"
ON public.market_listings
FOR SELECT
USING (true);

-- Market stats (per-variant aggregates)
CREATE TABLE public.market_stats (
  id BIGINT PRIMARY KEY,
  car_variant_id INTEGER NOT NULL UNIQUE,
  sample_size INTEGER NOT NULL,
  avg_price NUMERIC,
  median_price NUMERIC,
  min_price NUMERIC,
  max_price NUMERIC,
  std_dev_price NUMERIC,
  variance_price NUMERIC,
  avg_mileage NUMERIC,
  price_mileage_corr NUMERIC,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_stats_variant ON public.market_stats(car_variant_id);

ALTER TABLE public.market_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read market stats"
ON public.market_stats
FOR SELECT
USING (true);

-- Reuse the existing update_updated_at_column() trigger function
CREATE TRIGGER update_market_listings_updated_at
BEFORE UPDATE ON public.market_listings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_market_stats_updated_at
BEFORE UPDATE ON public.market_stats
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();