/**
 * 本地开发专用账号：`npm run dev` 首次启动时自动写入本地模拟数据库（.dev-data/ledger.sqlite）。
 * 仅用于 localhost，与线上账号无关；线上账号用 `npm run user:create` 创建。
 */
export const DEV_USER = {
  username: 'dev',
  password: 'dev-pass-1234',
};

export const DEV_DB_FILE = '.dev-data/ledger.sqlite';
