CREATE TABLE IF NOT EXISTS feedback_recipients (
  feedback_id INTEGER PRIMARY KEY REFERENCES feedback(id) ON DELETE CASCADE,
  install_id TEXT NOT NULL, account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_recipient_install ON feedback_recipients(install_id);
CREATE INDEX IF NOT EXISTS idx_feedback_recipient_account ON feedback_recipients(account_id);
CREATE TABLE IF NOT EXISTS feedback_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  message TEXT NOT NULL, author_email TEXT NOT NULL, request_id TEXT NOT NULL,
  created_at TEXT NOT NULL, read_at TEXT,
  UNIQUE(feedback_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_reply_thread ON feedback_replies(feedback_id, id);
