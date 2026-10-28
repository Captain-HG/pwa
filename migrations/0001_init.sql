-- v1.1：账号、会话、登录限流、同步记录
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL,
  locked_until INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE records (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (user_id, entity, id)
);
CREATE INDEX idx_records_rev ON records(user_id, rev);
