-- v1.2：角色与权限
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO roles (id, name, description, permissions, builtin, created_at, updated_at) VALUES
  (1, '管理员', '拥有全部权限', '["*"]', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  (2, '普通成员', '记账、统计、分类、导出备份', '["ledger.view","ledger.edit","stats.view","category.manage","backup.export"]', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- SQLite 开启外键时，ADD COLUMN 带 REFERENCES 必须默认 NULL，因此这里不声明外键，由应用层保证
ALTER TABLE users ADD COLUMN role_id INTEGER NOT NULL DEFAULT 2;
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

-- 升级前已存在的账号都设为管理员
UPDATE users SET role_id = 1;
