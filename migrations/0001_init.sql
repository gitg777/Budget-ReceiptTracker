-- Budget & Receipt Tracker — first schema.
-- Money is stored as whole cents (INTEGER) so totals never drift from rounding.
-- Exchange rates are stored as "units of currency per 1 USD" (e.g. ZWG 26.61).

-- One household / business budget. The owner and their helpers belong to it.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Owners log in with email + password; helpers with a username + PIN the owner sets.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'helper')),
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  display_name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_users_account ON users(account_id);

-- Login sessions. Only a hash of the token is stored, so a leaked database can't be used to log in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Failed-login counter used to lock out password guessing.
CREATE TABLE login_failures (
  login TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at TEXT NOT NULL
);

-- Categories belong to an account (seeded with the default list, owner can add more).
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  monthly_budget_cents INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (account_id, name)
);

-- Helper allowance settings. period: weekly | monthly | none (one running float).
-- carry_over = 1 means unspent allowance flows into the next period.
CREATE TABLE helper_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  allowance_cents INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'none')),
  carry_over INTEGER NOT NULL DEFAULT 1,
  starts_on TEXT NOT NULL
);

-- One uploaded photo / PDF. A single photo can hold several receipts.
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL UNIQUE,          -- set by the phone, stops double uploads after a dropped connection
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed')),
  error TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  raw_json TEXT,                           -- what Claude returned, kept for checking mistakes later
  created_at TEXT NOT NULL
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  upload_id INTEGER REFERENCES uploads(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'saved')),
  merchant TEXT,
  receipt_date TEXT,                       -- YYYY-MM-DD
  currency TEXT NOT NULL DEFAULT 'USD',
  total_cents INTEGER NOT NULL DEFAULT 0,  -- in the receipt's own currency
  rate_per_usd REAL NOT NULL DEFAULT 1,    -- rate used at save time; never recalculated later
  rate_source TEXT NOT NULL DEFAULT 'usd' CHECK (rate_source IN ('usd', 'auto', 'manual', 'receipt')),
  rate_date TEXT,
  total_usd_cents INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES categories(id),  -- default for its line items
  payment_method TEXT,
  paid_by TEXT NOT NULL DEFAULT 'owner' CHECK (paid_by IN ('owner', 'float', 'own')),
  reimbursed_at TEXT,                      -- for paid_by = 'own': when the owner paid the helper back
  printed_rate REAL,                       -- exchange rate printed on the receipt, if any
  confidence TEXT,                         -- high | medium | low, from the reading
  notes TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_receipts_account_date ON receipts(account_id, receipt_date);
CREATE INDEX idx_receipts_creator ON receipts(created_by);

CREATE TABLE line_items (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  raw_text TEXT,                           -- exactly as printed, e.g. "MLK FC 2L"
  name TEXT NOT NULL,                      -- cleaned up, e.g. "Milk, fresh cream, 2L"
  quantity REAL,
  amount_cents INTEGER NOT NULL,           -- line total in the receipt's currency
  amount_usd_cents INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id)
);
CREATE INDEX idx_line_items_receipt ON line_items(receipt_id);
CREATE INDEX idx_line_items_name ON line_items(name);

-- Audit trail: every change to a saved receipt, who made it, and why.
CREATE TABLE receipt_edits (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  changes TEXT NOT NULL,                   -- JSON list of {field, from, to}
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_edits_receipt ON receipt_edits(receipt_id);

-- Exchange rates. account_id NULL = automatic daily rate shared by everyone;
-- account_id set = a rate the owner typed in.
CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  currency TEXT NOT NULL,
  rate_per_usd REAL NOT NULL,
  rate_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  provider TEXT,
  set_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_rates_unique ON exchange_rates(IFNULL(account_id, 0), currency, rate_date, source);

-- Helper cash movements (all in USD):
--   given      owner hands cash to the helper
--   returned   helper hands change back
--   adjustment difference found at a cash-up (declared cash minus expected cash)
--   reimbursed owner pays the helper back for receipts paid with the helper's own money
CREATE TABLE cash_ledger (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  helper_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('given', 'returned', 'adjustment', 'reimbursed')),
  amount_cents INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cash_helper ON cash_ledger(helper_id);

-- Cash-ups: the helper counts the cash in hand and the app compares it to what it should be.
CREATE TABLE cash_ups (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  helper_id INTEGER NOT NULL REFERENCES users(id),
  expected_cents INTEGER NOT NULL,
  declared_cents INTEGER NOT NULL,
  returned_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
