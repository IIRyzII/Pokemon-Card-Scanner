-- Multi-currency support: prices are converted with the ECB's daily reference rates.

-- Sales and purchase prices remember the currency they were entered in
-- (rows created before this migration were entered in US dollars).
ALTER TABLE sales ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE collection_items ADD COLUMN purchase_currency TEXT;
UPDATE collection_items SET purchase_currency = 'USD' WHERE purchase_price IS NOT NULL;

-- Each stored value records which currency it was calculated in.
ALTER TABLE collection_items ADD COLUMN value_currency TEXT;
UPDATE collection_items SET value_currency = 'USD' WHERE value IS NOT NULL;

-- Latest exchange rates (a single row), refreshed at most twice a day.
CREATE TABLE fx_rates (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rates_date TEXT NOT NULL,
  per_eur TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
