-- Sealed products in the collection: booster boxes, Elite Trainer Boxes, packs, tins and the rest.
-- Each is one of Cardmarket's products (the catalogue's sealed.json lists them, with prices). Its
-- name and kind are kept here too, in case it ever leaves that list.

CREATE TABLE sealed_items (
  id TEXT PRIMARY KEY,
  -- Cardmarket's product id
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- What kind of product it is: 'Booster box', 'Elite Trainer Box'…
  type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  -- What was paid for one
  purchase_price REAL,
  purchase_currency TEXT,
  purchase_date TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sealed_product ON sealed_items(product_id);
