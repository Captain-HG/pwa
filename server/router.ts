import {
  changePassword,
  getSession,
  listSessions,
  login,
  logout,
  revokeSession,
  SESSION_TTL,
  type AuthResult,
} from './auth';
import {
  checkWriteRequest,
  clearSessionCookie,
  errorResponse,
  HttpError,
  json,
  readJson,
  redirect,
  sessionCookie,
} from './http';
import { loginPage } from './loginPage';
import { swKillSwitch } from './swKillSwitch';
import { parsePullParams, pullChanges, pushChanges, validateChanges } from './sync';
import type { Env, Session } from './types';
import { canAny, PULL_PERMISSIONS, PUSH_PERMISSIONS } from '../shared/permissions';
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  listRoles,
  listUsers,
  resetUserPassword,
  updateRole,
  updateUser,
} from './admin';

/** 未登录也可访问的静态文件（「添加到主屏幕」需要读取图标和 manifest） */
const PUBLIC_PATHS = new Set([
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/pwa-192.png',
  '/pwa-512.png',
  '/manifest.webmanifest',
]);

interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  session: Session;
  now: number;
}

type Handler = (ctx: Ctx, params: string[]) => Promise<Response>;

/** 没有任一所需权限时返回 403 */
function requireAny(session: Session, keys: string[]): void {
  if (!canAny(session.permissions, keys)) throw new HttpError(403, '没有权限');
}

const ok = () => json({ ok: true });
const idOf = (s: string) => Number(s);

const routes: [string, RegExp, Handler][] = [
  [
    'GET',
    /^\/api\/auth\/me$/,
    async ({ session }) =>
      json({
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
        role: session.roleName,
        permissions: session.permissions,
      }),
  ],
  [
    'POST',
    /^\/api\/auth\/logout$/,
    async ({ env, session }) => {
      await logout(env.DB, session);
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    },
  ],
  [
    'POST',
    /^\/api\/auth\/password$/,
    async ({ env, session, request, now }) => {
      const body = await readJson<{ oldPassword?: unknown; newPassword?: unknown }>(request);
      await changePassword(env.DB, session, body.oldPassword, body.newPassword, now);
      return ok();
    },
  ],
  ['GET', /^\/api\/auth\/sessions$/, async ({ env, session, now }) => json({ sessions: await listSessions(env.DB, session, now) })],
  [
    'DELETE',
    /^\/api\/auth\/sessions\/([0-9a-f]{64})$/,
    async ({ env, session }, [id]) => {
      await revokeSession(env.DB, session, id);
      return ok();
    },
  ],
  [
    'POST',
    /^\/api\/sync\/push$/,
    async ({ env, session, request }) => {
      const changes = validateChanges(await readJson(request));
      for (const c of changes) requireAny(session, PUSH_PERMISSIONS[c.entity] ?? []);
      return json({ applied: await pushChanges(env.DB, session.userId, changes) });
    },
  ],
  [
    'GET',
    /^\/api\/sync\/pull$/,
    async ({ env, session, url }) => {
      requireAny(session, PULL_PERMISSIONS);
      const { since, limit } = parsePullParams(url);
      return json(await pullChanges(env.DB, session.userId, since, limit));
    },
  ],

  // ---------- 用户管理 ----------
  [
    'GET',
    /^\/api\/admin\/users$/,
    async ({ env, session }) => {
      requireAny(session, ['admin.users']);
      return json({ users: await listUsers(env.DB) });
    },
  ],
  [
    'POST',
    /^\/api\/admin\/users$/,
    async ({ env, session, request, now }) => {
      requireAny(session, ['admin.users']);
      return json({ id: await createUser(env.DB, await readJson(request), now) });
    },
  ],
  [
    'PATCH',
    /^\/api\/admin\/users\/(\d+)$/,
    async ({ env, session, request, now }, [id]) => {
      requireAny(session, ['admin.users']);
      await updateUser(env.DB, session, idOf(id), await readJson(request), now);
      return ok();
    },
  ],
  [
    'POST',
    /^\/api\/admin\/users\/(\d+)\/password$/,
    async ({ env, session, request, now }, [id]) => {
      requireAny(session, ['admin.users']);
      const body = await readJson<{ password?: unknown }>(request);
      await resetUserPassword(env.DB, idOf(id), body.password, now);
      return ok();
    },
  ],
  [
    'DELETE',
    /^\/api\/admin\/users\/(\d+)$/,
    async ({ env, session }, [id]) => {
      requireAny(session, ['admin.users']);
      await deleteUser(env.DB, session, idOf(id));
      return ok();
    },
  ],

  // ---------- 角色管理 ----------
  [
    'GET',
    /^\/api\/admin\/roles$/,
    async ({ env, session }) => {
      requireAny(session, ['admin.roles', 'admin.users']);
      return json({ roles: await listRoles(env.DB) });
    },
  ],
  [
    'POST',
    /^\/api\/admin\/roles$/,
    async ({ env, session, request, now }) => {
      requireAny(session, ['admin.roles']);
      return json({ id: await createRole(env.DB, await readJson(request), now) });
    },
  ],
  [
    'PATCH',
    /^\/api\/admin\/roles\/(\d+)$/,
    async ({ env, session, request, now }, [id]) => {
      requireAny(session, ['admin.roles']);
      await updateRole(env.DB, idOf(id), await readJson(request), now);
      return ok();
    },
  ],
  [
    'DELETE',
    /^\/api\/admin\/roles\/(\d+)$/,
    async ({ env, session }, [id]) => {
      requireAny(session, ['admin.roles']);
      await deleteRole(env.DB, idOf(id));
      return ok();
    },
  ],
];

/**
 * 全站入口：生产环境由 functions/_middleware.ts 调用，本地开发由 Vite 插件调用。
 * next() 返回静态文件。
 */
export async function handle(
  request: Request,
  env: Env,
  next: () => Promise<Response>,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (PUBLIC_PATHS.has(path)) return next();

    if (path === '/api/auth/login') {
      if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);
      const bad = checkWriteRequest(request);
      if (bad) return bad;
      const body = await readJson<{ username?: unknown; password?: unknown }>(request);
      const { username, token } = await login(env.DB, request, body.username, body.password, now);
      return json({ username }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_TTL / 1000) });
    }

    const auth: AuthResult | null = await getSession(env.DB, request, now);

    if (path === '/login') return auth ? redirect('/') : loginPage();

    if (!auth) {
      if (path.startsWith('/api/')) return errorResponse('未登录或登录已失效', 401);
      // Service Worker 脚本不能重定向，否则旧版本无法更新、一直停在缓存页面
      if (path === '/sw.js') return swKillSwitch();
      return redirect('/login');
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const bad = checkWriteRequest(request);
      if (bad) return bad;
    }

    let res: Response;
    if (path.startsWith('/api/')) {
      res = errorResponse('接口不存在', 404);
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(path);
        if (m && method === request.method) {
          res = await handler({ request, env, url, session: auth.session, now }, m.slice(1));
          break;
        }
      }
    } else {
      res = await next();
    }

    if (auth.renewCookie) {
      res = new Response(res.body, res);
      res.headers.append('Set-Cookie', auth.renewCookie);
    }
    return res;
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error(e);
    return errorResponse('服务器错误', 500);
  }
}
