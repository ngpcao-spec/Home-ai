-- The UNIQUE constraint index on (quote_id, position) serves the same ordered
-- lookups as this non-unique duplicate.
drop index if exists public.quote_items_quote_idx;
