-- 0002_tasks: task management, per-field change history, and the development log.

CREATE TABLE tasks (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seq                   INTEGER NOT NULL,                -- per-user sequence
  task_code             TEXT NOT NULL,                   -- human ID, e.g. TSK-0001
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT 'Other',
  assigned_date         TEXT NOT NULL,                   -- local YYYY-MM-DD
  start_time            TEXT,                            -- UTC ISO
  deadline              TEXT,                            -- UTC ISO
  priority              TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status                TEXT NOT NULL DEFAULT 'Not Started'
                        CHECK (status IN ('Not Started', 'In Progress', 'Under Review', 'Completed', 'On Hold', 'Blocked')),
  estimated_minutes     INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
  actual_minutes        INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  progress_percent      INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  implementation_notes  TEXT NOT NULL DEFAULT '',
  blockers              TEXT NOT NULL DEFAULT '',
  completed_at          TEXT,                            -- UTC ISO
  reference_url         TEXT,                            -- GitHub / project reference
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at            TEXT,                            -- soft delete keeps history & report references intact
  UNIQUE (user_id, seq)
);
CREATE INDEX idx_tasks_user_date ON tasks (user_id, assigned_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_user_status ON tasks (user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_user_category ON tasks (user_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_user_deadline ON tasks (user_id, deadline) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_user_completed ON tasks (user_id, completed_at) WHERE deleted_at IS NULL;

-- Preserves every change: one row per changed field.
CREATE TABLE task_activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN ('created', 'updated', 'status_changed', 'duplicated', 'deleted', 'restored')),
  field      TEXT,
  old_value  TEXT,
  new_value  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_task_activity_task ON task_activity_logs (task_id, created_at);

-- Module E: structured development log (what was built, tech, problems, solutions, next steps).
CREATE TABLE dev_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  log_date     TEXT NOT NULL,                            -- local YYYY-MM-DD
  area         TEXT NOT NULL,
  task_id      INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
  implemented  TEXT NOT NULL DEFAULT '',
  technologies TEXT NOT NULL DEFAULT '',
  problems     TEXT NOT NULL DEFAULT '',
  solutions    TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'In Progress'
               CHECK (status IN ('Not Started', 'In Progress', 'Under Review', 'Completed', 'On Hold', 'Blocked')),
  next_plan    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_dev_logs_user_date ON dev_logs (user_id, log_date);
CREATE INDEX idx_dev_logs_task ON dev_logs (task_id);
