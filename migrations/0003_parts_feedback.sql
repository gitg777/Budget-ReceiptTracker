-- Long receipts: one upload can hold several photos (parts, top to bottom), read together.
-- extra_keys is a JSON array of the R2 keys after the first (r2_key stays the first part).
ALTER TABLE uploads ADD COLUMN extra_keys TEXT;
-- 'full' reads every line; 'totals' reads only shop, date and total (cheaper, for very long slips).
ALTER TABLE uploads ADD COLUMN mode TEXT NOT NULL DEFAULT 'full';

-- Feedback sent from inside the app, read on the operator screen.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('problem', 'idea', 'question', 'praise')),
  message TEXT NOT NULL,
  page TEXT,
  app_info TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done')),
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_status ON feedback(status, id);
