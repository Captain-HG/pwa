/**
 * D1 的最小接口子集。生产环境传入 Cloudflare D1，本地开发与测试传入 sql.js 适配器，
 * 服务端代码因此不依赖 Workers 运行时。
 */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<{ meta: { changes?: number } }[]>;
}

export interface Env {
  DB: D1Like;
}

export interface Session {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  permissions: string[];
}
