-- 0004_reports: daily reports (versioned revisions), their task links, and TL reviews.

CREATE TABLE daily_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  report_date  TEXT NOT NULL,                            -- local YYYY-MM-DD
  revision     INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'submitted', 'viewed', 'reviewed', 'revision_requested', 'approved')),
  header_json  TEXT NOT NULL,                            -- employee, mentor, attendance snapshot
  content_json TEXT NOT NULL,                            -- editable report sections
  share_token  TEXT NOT NULL UNIQUE,                     -- unguessable link token (only served once submitted)
  submitted_at TEXT,
  viewed_at    TEXT,
  reviewed_at  TEXT,
  pdf_key      TEXT,                                     -- optional R2 object key
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, report_date, revision)
);
CREATE INDEX idx_reports_user_date ON daily_reports (user_id, report_date);
CREATE INDEX idx_reports_status ON daily_reports (status);

-- Relational index of which tasks a report covers (rewritten whenever a draft is saved).
CREATE TABLE report_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id        INTEGER NOT NULL REFERENCES daily_reports (id) ON DELETE CASCADE,
  task_id          INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  section          TEXT NOT NULL CHECK (section IN ('completed', 'in_progress', 'pending')),
  task_code        TEXT,
  title            TEXT NOT NULL,
  category         TEXT,
  status_at_report TEXT
);
CREATE INDEX idx_report_tasks_report ON report_tasks (report_id);
CREATE INDEX idx_report_tasks_task ON report_tasks (task_id);

CREATE TABLE report_reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id        INTEGER NOT NULL REFERENCES daily_reports (id) ON DELETE CASCADE,
  reviewer_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reviewer_name    TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('viewed', 'comment', 'reviewed', 'revision_requested', 'approved')),
  comment          TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_report_reviews_report ON report_reviews (report_id, created_at);
