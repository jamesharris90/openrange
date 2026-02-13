-- Add Perplexity storage columns
ALTER TABLE users ADD COLUMN pplx_api_key TEXT;
ALTER TABLE users ADD COLUMN pplx_model TEXT;
