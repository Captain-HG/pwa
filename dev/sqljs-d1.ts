/**
 * 用 sql.js（WASM 版 SQLite）模拟 D1，供本地开发与测试使用。
 * 本机的 workerd 无法启动，因此不依赖 wrangler 的本地运行时。
 */
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { D1Like, D1Stmt } from '../server/types';

function normalize(v: unknown): SqlValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SqlValue;
}

class Stmt implements D1Stmt {
  constructor(
    private owner: SqlJsD1,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1Stmt {
    return new Stmt(this.owner, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    return (this.exec()[0] as T) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.exec() as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const changes = this.execWrite();
    this.owner.persist();
    return { meta: { changes } };
  }

  /** 供 batch 使用：执行但不持久化 */
  execWrite(): number {
    this.exec();
    return this.owner.db.getRowsModified();
  }

  private exec(): Record<string, unknown>[] {
    const st = this.owner.db.prepare(this.sql);
    try {
      st.bind(this.params.map(normalize));
      const rows: Record<string, unknown>[] = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  }
}

export class SqlJsD1 implements D1Like {
  private mtime = 0;

  constructor(
    public db: Database,
    private file?: string,
    private SQL?: initSqlJs.SqlJsStatic,
  ) {}

  /** 数据库文件被外部修改（如 scripts/create_user.py --dev）时重新加载 */
  reloadIfChanged(): void {
    if (!this.file || !this.SQL || !fs.existsSync(this.file)) return;
    const m = fs.statSync(this.file).mtimeMs;
    if (m > this.mtime) {
      this.db.close();
      this.db = new this.SQL.Database(fs.readFileSync(this.file));
      this.db.exec('PRAGMA foreign_keys = ON');
      this.mtime = m;
    }
  }

  prepare(sql: string): D1Stmt {
    return new Stmt(this, sql);
  }

  /** 与 D1 一致：batch 内的语句在一个事务中执行，任一失败全部回滚 */
  async batch(statements: D1Stmt[]): Promise<{ meta: { changes: number } }[]> {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => ({ meta: { changes: (s as Stmt).execWrite() } }));
      this.db.exec('COMMIT');
      this.persist();
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  persist(): void {
    if (!this.file) return;
    fs.writeFileSync(this.file, Buffer.from(this.db.export()));
    this.mtime = fs.statSync(this.file).mtimeMs;
  }
}

/**
 * 创建数据库；file 为空时只在内存中。
 * 与 wrangler 一样用 d1_migrations 表记录已执行的迁移，启动时补跑 migrations 目录中新增的 SQL。
 */
export async function createSqlJsD1(options: { migrationsDir: string; file?: string }): Promise<SqlJsD1> {
  const SQL = await initSqlJs();
  const exists = !!options.file && fs.existsSync(options.file);
  const db = exists ? new SQL.Database(fs.readFileSync(options.file!)) : new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON');
  const d1 = new SqlJsD1(db, options.file, SQL);
  if (exists) d1.reloadIfChanged();
  if (options.file) fs.mkdirSync(path.dirname(options.file), { recursive: true });
  applyMigrations(d1, options.migrationsDir);
  return d1;
}

function applyMigrations(d1: SqlJsD1, dir: string): void {
  const db = d1.db;
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)');
  const applied = new Set(db.exec('SELECT name FROM d1_migrations')[0]?.values.map((r) => String(r[0])) ?? []);
  // 早期创建的开发库没有迁移记录，但已经有 0001 的表
  if (!applied.size && db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").length) {
    db.exec("INSERT INTO d1_migrations (name, applied_at) VALUES ('0001_init.sql', datetime('now'))");
    applied.add('0001_init.sql');
  }
  let changed = false;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      db.run("INSERT INTO d1_migrations (name, applied_at) VALUES (?, datetime('now'))", [f]);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    changed = true;
  }
  if (changed) d1.persist();
}
