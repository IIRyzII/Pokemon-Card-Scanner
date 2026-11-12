-- Selling: copies of a collection entry put up for sale, and the sales made.

-- How many of the entry's copies are for sale (0: none), the asking price for one, and where.
ALTER TABLE collection_items ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collection_items ADD COLUMN asking_price REAL;
ALTER TABLE collection_items ADD COLUMN asking_currency TEXT;
ALTER TABLE collection_items ADD COLUMN sale_platform TEXT;
ALTER TABLE collection_items ADD COLUMN listing_url TEXT;
ALTER TABLE collection_items ADD COLUMN listed_at TEXT;

-- A sale of copies from the collection. The card and the copy's details are kept here, so the
-- sale and its profit stay in the history when the entry they came from is gone.
CREATE TABLE sold_items (
  id TEXT PRIMARY KEY,
  -- The entry the copies came from (it may since have been deleted for good)
  item_id TEXT,
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  set_name TEXT,
  number TEXT,
  set_total INTEGER,
  image TEXT,
  variant TEXT NOT NULL,
  language TEXT,
  grader TEXT NOT NULL,
  grade REAL,
  grade_label TEXT,
  condition TEXT,
  quantity INTEGER NOT NULL,
  -- How many of them were for sale (undoing the sale puts those back on sale)
  from_sale INTEGER NOT NULL DEFAULT 0,
  -- What one sold for
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  -- The selling fees and the postage paid, for the whole sale, in its currency
  fees REAL,
  postage REAL,
  -- What one cost when bought (from the entry)
  purchase_price REAL,
  purchase_currency TEXT,
  platform TEXT,
  sold_on TEXT NOT NULL,
  note TEXT,
  -- The sale logged for the card's value (sales.id), taken back with this one
  sale_id TEXT,
  -- These were the entry's last copies, so it was taken out of the collection
  emptied INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX sold_items_sold_on ON sold_items(sold_on);
