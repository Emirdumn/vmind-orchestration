
CREATE SEQUENCE IF NOT EXISTS public.market_listings_id_seq OWNED BY public.market_listings.id;
ALTER TABLE public.market_listings ALTER COLUMN id SET DEFAULT nextval('public.market_listings_id_seq');
SELECT setval('public.market_listings_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM public.market_listings),1));

CREATE SEQUENCE IF NOT EXISTS public.market_stats_id_seq OWNED BY public.market_stats.id;
ALTER TABLE public.market_stats ALTER COLUMN id SET DEFAULT nextval('public.market_stats_id_seq');
SELECT setval('public.market_stats_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM public.market_stats),1));
