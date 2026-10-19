-- Reading credit: every account pays for receipt reading from a prepaid balance.
-- Amounts are micro-dollars (1 USD = 1,000,000) because one reading costs a fraction of a cent.

ALTER TABLE accounts ADD COLUMN credit_micros INTEGER NOT NULL DEFAULT 0;
-- 1 = never charged (the app operator's own account)
ALTER TABLE accounts ADD COLUMN unlimited INTEGER NOT NULL DEFAULT 0;
-- 1 = can see every account and add credit
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- What Anthropic charged for this reading, and what the account was charged
ALTER TABLE uploads ADD COLUMN cost_micros INTEGER;
ALTER TABLE uploads ADD COLUMN charge_micros INTEGER;

-- Every change to an account's credit:
--   grant   free starting credit
--   topup   credit added by the operator after payment
--   usage   a receipt reading (negative)
--   adjust  manual correction (either sign)
CREATE TABLE credit_ledger (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'topup', 'usage', 'adjust')),
  amount_micros INTEGER NOT NULL,
  upload_id INTEGER REFERENCES uploads(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_credit_account ON credit_ledger(account_id, id);

-- Accounts that already exist get the same free starting credit as new ones.
INSERT INTO credit_ledger (account_id, kind, amount_micros, note, created_at)
  SELECT id, 'grant', 5000000, 'Free starting credit', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM accounts;
UPDATE accounts SET credit_micros = credit_micros + 5000000;
