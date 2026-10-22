-- The want list: cards picked by hand to get, alongside the gaps in the binders (which the app
-- works out from the binders and the collection, so they aren't stored here).

CREATE TABLE wants (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  -- The printing wanted (normal, holo, reverse, firstEdition, wPromo)
  variant TEXT NOT NULL,
  -- Copies wanted in all (copies already in the collection count towards it)
  quantity INTEGER NOT NULL DEFAULT 1,
  -- 1 must have, 2 want, 3 someday
  priority INTEGER NOT NULL DEFAULT 2,
  -- The most you'd pay for one copy: the app calls it a deal when the market price is at or below
  max_price REAL,
  max_currency TEXT,
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (card_id, variant)
);
