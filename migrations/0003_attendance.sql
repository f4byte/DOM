-- 0003_attendance: daily attendance, device/manual events, audit trail, and device webhook tokens.

CREATE TABLE attendance (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  work_date               TEXT NOT NULL,                 -- local YYYY-MM-DD (date of first login)
  first_login_at          TEXT,                          -- UTC ISO
  last_logout_at          TEXT,                          -- UTC ISO
  late_minutes            INTEGER NOT NULL DEFAULT 0,
  early_arrival_minutes   INTEGER NOT NULL DEFAULT 0,
  early_departure_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes        INTEGER NOT NULL DEFAULT 0,
  worked_minutes          INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'present'
                          CHECK (status IN ('present', 'late', 'early_leave', 'late_early_leave', 'overtime',
                                            'in_progress', 'missing_logout', 'leave', 'holiday', 'absent')),
  status_manual           INTEGER NOT NULL DEFAULT 0 CHECK (status_manual IN (0, 1)),
  login_source            TEXT CHECK (login_source IN ('automatic', 'manual')),
  logout_source           TEXT CHECK (logout_source IN ('automatic', 'manual')),
  notes                   TEXT NOT NULL DEFAULT '',
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, work_date)                            -- guarantees no duplicate attendance records
);
CREATE INDEX idx_attendance_user_date ON attendance (user_id, work_date);

-- Raw signals: device unlock/lock (automatic) and manual login/logout clicks.
CREATE TABLE attendance_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL CHECK (event_type IN ('unlock', 'lock', 'login', 'logout')),
  occurred_at      TEXT NOT NULL,                        -- UTC ISO
  work_date        TEXT NOT NULL,                        -- local YYYY-MM-DD
  source           TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  device_label     TEXT,
  suggested_action TEXT CHECK (suggested_action IN ('login', 'logout')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'rejected', 'ignored', 'superseded')),
  ignore_reason    TEXT,
  attendance_id    INTEGER REFERENCES attendance (id) ON DELETE SET NULL,
  raw_payload      TEXT,
  resolved_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_events_user_date ON attendance_events (user_id, work_date);
CREATE INDEX idx_events_user_status ON attendance_events (user_id, status);
-- Retried webhook deliveries of the same event are rejected by this unique index.
CREATE UNIQUE INDEX uq_events_dedupe ON attendance_events (user_id, event_type, occurred_at, source);

-- Every manual correction is recorded with its reason.
CREATE TABLE attendance_audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance (id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action        TEXT NOT NULL,                           -- e.g. clock_in, clock_out, manual_correction, event_confirmed
  field         TEXT,
  old_value     TEXT,
  new_value     TEXT,
  reason        TEXT,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('automatic', 'manual')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_attendance ON attendance_audit_logs (attendance_id, created_at);

-- Bearer tokens for the Android automation webhook. Only the SHA-256 hash is stored.
CREATE TABLE device_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);
