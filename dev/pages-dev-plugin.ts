/**
 * Vite 开发插件：在 `npm run dev` 中模拟 Cloudflare Pages Functions，
 * 让登录页、鉴权中间件和 /api/* 在本地以与线上相同的逻辑运行（数据库为 sql.js）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { hashPassword } from '../server/crypto';
import { handle } from '../server/router';
import { createSqlJsD1, type SqlJsD1 } from './sqljs-d1';
import { DEV_DB_FILE, DEV_USER } from './dev-config';

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  headers.set('CF-Connecting-IP', req.socket.remoteAddress ?? 'unknown');
  const body = await readBody(req);
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body });
}

async function sendResponse(res: ServerResponse, r: Response): Promise<void> {
  res.statusCode = r.status;
  r.headers.forEach((v, k) => {
    if (k !== 'set-cookie') res.setHeader(k, v);
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await r.arrayBuffer()));
}

/** Vite 自身的资源请求不经过鉴权，避免开发时热更新异常 */
function isViteInternal(url: string): boolean {
  return /^\/(@vite|@id|@fs|node_modules|__vite)/.test(url);
}

export function pagesDevPlugin(root: string): Plugin {
  let dbPromise: Promise<SqlJsD1> | undefined;
  const getDb = () =>
    (dbPromise ??= (async () => {
      const db = await createSqlJsD1({
        migrationsDir: path.join(root, 'migrations'),
        file: path.join(root, DEV_DB_FILE),
      });
      const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
      if (!row?.n) {
        const now = Date.now();
        await db
          .prepare('INSERT INTO users (username, password_hash, role_id, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)')
          .bind(DEV_USER.username, await hashPassword(DEV_USER.password), now)
          .run();
        console.log(`\n  [pages-dev] 已创建本地开发账号，见 dev/dev-config.ts\n`);
      }
      return db;
    })());

  return {
    name: 'pages-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || isViteInternal(req.url)) return next();
        try {
          const request = await toRequest(req);
          let passed = false;
          const db = await getDb();
          db.reloadIfChanged();
          const response = await handle(request, { DB: db }, async () => {
            passed = true;
            return new Response(null, { status: 204 });
          });
          // 放行的静态请求交还给 Vite（续期 Cookie 一并带上）
          if (passed && response.status === 204) {
            const cookies = response.headers.getSetCookie();
            if (cookies.length) res.setHeader('Set-Cookie', cookies);
            return next();
          }
          await sendResponse(res, response);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}
