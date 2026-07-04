-- Cache table for scraped car listings
CREATE TABLE public.scraped_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price NUMERIC,
  year INTEGER,
  km INTEGER,
  city TEXT,
  image TEXT,
  search_url TEXT,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_scraped_listings_source ON public.scraped_listings(source);
CREATE INDEX idx_scraped_listings_search_url ON public.scraped_listings(search_url);
CREATE INDEX idx_scraped_listings_last_seen ON public.scraped_listings(last_seen_at DESC);

ALTER TABLE public.scraped_listings ENABLE ROW LEVEL SECURITY;

-- Public read (anyone can browse cached listings)
CREATE POLICY "Anyone can read scraped listings"
ON public.scraped_listings
FOR SELECT
USING (true);

-- Writes happen only via edge function using the service role key,
-- so no INSERT/UPDATE/DELETE policy is granted to anon/authenticated users.

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_scraped_listings_updated_at
BEFORE UPDATE ON public.scraped_listings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();