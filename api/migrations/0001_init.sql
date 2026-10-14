-- PokéVault database (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pending', 'viewer', 'editor', 'admin')),
  -- The browser stretches the password with PBKDF2-SHA256 (600k rounds) before
  -- sending it; we store SHA-256(salt || that key), so plain passwords never reach us.
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);

-- One shared collection; roles decide who can change it.
CREATE TABLE collection_items (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  number TEXT NOT NULL,
  set_total INTEGER,
  rarity TEXT,
  artist TEXT,
  image TEXT,
  dex_id INTEGER,
  variant TEXT NOT NULL DEFAULT 'normal',
  grader TEXT NOT NULL DEFAULT 'RAW',
  grade REAL,
  grade_label TEXT,
  condition TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  purchase_price REAL,
  purchase_date TEXT,
  cert_number TEXT,
  notes TEXT,
  value REAL,
  value_source TEXT,
  value_detail TEXT,
  value_updated_at TEXT,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE INDEX collection_card ON collection_items(card_id);
CREATE INDEX collection_deleted ON collection_items(deleted_at);

-- Normalized card details from the open TCGdex data, cached so we only fetch a card occasionally.
CREATE TABLE card_cache (
  card_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Latest price points per card. source: tcgplayer | cardmarket | pricecharting
CREATE TABLE card_prices (
  card_id TEXT NOT NULL,
  source TEXT NOT NULL,
  variant TEXT NOT NULL,
  grade_key TEXT NOT NULL,
  market REAL,
  low REAL,
  mid REAL,
  high REAL,
  currency TEXT NOT NULL,
  label TEXT,
  url TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (card_id, source, variant, grade_key)
);

-- Our own price history: one point per card/source/variant/grade per day.
CREATE TABLE price_history (
  card_id TEXT NOT NULL,
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  variant TEXT NOT NULL,
  grade_key TEXT NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (card_id, source, variant, grade_key, day)
);

CREATE TABLE price_refresh (
  card_id TEXT PRIMARY KEY,
  refreshed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT
);

-- Which PriceCharting product a card+variant maps to (auto-matched, can be corrected).
CREATE TABLE pricecharting_map (
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  console_name TEXT NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (card_id, variant)
);

-- Sold comps (e.g. eBay last solds) logged by editors; graded and raw.
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  grader TEXT NOT NULL,
  grade REAL,
  grade_label TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  sold_on TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sales_card ON sales(card_id, sold_on);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_created ON audit_log(created_at);
