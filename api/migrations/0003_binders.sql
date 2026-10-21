-- Binders: the real binders a collection is kept in, page by page. What goes in each pocket is
-- stored here; which pockets are filled comes from the collection.

CREATE TABLE binders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Pockets per page: 4 (2×2), 9 (3×3) or 12 (3×4)
  pockets INTEGER NOT NULL DEFAULT 9,
  -- JSON, in pocket order: [{ "cardId": "sv04-001", "variant": "normal", "copies": 1 }, …]
  cards TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
