import path from 'node:path';
import { createSqlJsD1, type SqlJsD1 } from '../../dev/sqljs-d1';
import { hashPassword } from '../../server/crypto';
import { handle } from '../../server/router';

export const ORIGIN = 'https://ledger.test';
export const USER = { username: 'me', password: 'correct-horse-1' };

/** 一台「设备」：独立的 Cookie */
export interface Client {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  login(password?: string): Promise<Response>;
  cookie: string;
}

export interface TestServer {
  db: SqlJsD1;
  now: { value: number };
  /** 一台「设备」；username / password 默认是管理员 USER */
  client(username?: string, password?: string): Client;
  addUser(username: string, password: string, roleId: number): Promise<number>;
}

export async function createTestServer(): Promise<TestServer> {
  const db = await createSqlJsD1({ migrationsDir: path.resolve(__dirname, '../../migrations') });
  const now = { value: Date.now() };
  const addUser = async (username: string, password: string, roleId: number) => {
    await db
      .prepare('INSERT INTO users (username, password_hash, role_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)')
      .bind(username, await hashPassword(password, 1000), roleId, now.value)
      .run();
    return (await db.prepare('SELECT id FROM users WHERE username = ?1').bind(username).first<{ id: number }>())!.id;
  };
  await addUser(USER.username, USER.password, 1);

  const client = (username = USER.username, defaultPassword = USER.password): Client => {
    const c: Client = {
      cookie: '',
      async fetch(p, init = {}) {
        const headers = new Headers(init.headers);
        if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
        if (c.cookie) headers.set('Cookie', c.cookie);
        const res = await handle(
          new Request(ORIGIN + p, { ...init, headers }),
          { DB: db },
          async () => new Response('static'),
          now.value,
        );
        for (const sc of res.headers.getSetCookie()) {
          const kv = sc.split(';')[0];
          c.cookie = kv.endsWith('=') ? '' : kv;
        }
        return res;
      },
      login(password = defaultPassword) {
        return c.fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
      },
    };
    return c;
  };

  return { db, now, client, addUser };
}

export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
