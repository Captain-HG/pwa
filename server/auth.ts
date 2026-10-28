import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto';
import { HttpError, SESSION_COOKIE, clientIp, getCookie, sessionCookie } from './http';
import type { D1Like, Session } from './types';

const DAY = 86_400_000;
export const SESSION_TTL = 90 * DAY;
const RENEW_BELOW = 60 * DAY;
const SEEN_INTERVAL = 3_600_000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD = 8;

interface SessionRow {
  id: string;
  user_id: number;
  username: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string;
  last_seen_at: number;
  expires_at: number;
}

function parsePermissions(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface AuthResult {
  session: Session;
  /** 需要续期时附带的 Set-Cookie */
  renewCookie?: string;
}

export { parsePermissions };

export async function getSession(db: D1Like, request: Request, now = Date.now()): Promise<AuthResult | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, u.username, u.display_name, u.role_id, r.name AS role_name, r.permissions,
              s.last_seen_at, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE s.id = ?1 AND s.expires_at > ?2 AND u.disabled = 0`,
    )
    .bind(id, now)
    .first<SessionRow>();
  if (!row) return null;

  const result: AuthResult = {
    session: {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name || row.username,
      roleId: row.role_id,
      roleName: row.role_name ?? '',
      permissions: parsePermissions(row.permissions),
    },
  };
  if (now - row.last_seen_at > SEEN_INTERVAL) {
    let expires = row.expires_at;
    if (expires - now < RENEW_BELOW) {
      expires = now + SESSION_TTL;
      result.renewCookie = sessionCookie(token, SESSION_TTL / 1000);
    }
    await db.prepare('UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE id = ?3').bind(now, expires, id).run();
  }
  return result;
}

async function createSession(db: D1Like, userId: number, request: Request, now: number): Promise<string> {
  const token = randomToken();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)`,
    )
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL, request.headers.get('User-Agent')?.slice(0, 300) ?? '', clientIp(request))
    .run();
  return token;
}

// ---------- 登录限流 ----------

interface AttemptRow {
  key: string;
  fail_count: number;
  locked_until: number;
  updated_at: number;
}

async function lockedFor(db: D1Like, keys: string[], now: number): Promise<number> {
  let until = 0;
  for (const key of keys) {
    const row = await db.prepare('SELECT * FROM login_attempts WHERE key = ?1').bind(key).first<AttemptRow>();
    if (row && row.locked_until > until) until = row.locked_until;
  }
  return Math.max(0, until - now);
}

async function recordFailure(db: D1Like, keys: string[], now: number): Promise<void> {
  const stmts = [];
  for (const key of keys) {
    const row = await db.prepare('SELECT * FROM login_attempts WHERE key = ?1').bind(key).first<AttemptRow>();
    // 15 分钟内没有新的失败，计数重新开始
    let count = row && now - row.updated_at < LOCK_MS ? row.fail_count + 1 : 1;
    let lockedUntil = row?.locked_until ?? 0;
    if (count >= MAX_FAILURES) {
      lockedUntil = now + LOCK_MS;
      count = 0;
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO login_attempts (key, fail_count, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(key) DO UPDATE SET fail_count = ?2, locked_until = ?3, updated_at = ?4`,
        )
        .bind(key, count, lockedUntil, now),
    );
  }
  await db.batch(stmts);
}

async function clearFailures(db: D1Like, keys: string[]): Promise<void> {
  await db.batch(keys.map((k) => db.prepare('DELETE FROM login_attempts WHERE key = ?1').bind(k)));
}

// ---------- 业务 ----------

export interface LoginOutcome {
  username: string;
  token: string;
}

export async function login(
  db: D1Like,
  request: Request,
  username: unknown,
  password: unknown,
  now = Date.now(),
): Promise<LoginOutcome> {
  const name = typeof username === 'string' ? username.trim() : '';
  const pwd = typeof password === 'string' ? password : '';
  if (!name || !pwd || name.length > 64 || pwd.length > 256) throw new HttpError(400, '请输入用户名和密码');

  const keys = [`ip:${clientIp(request)}`, `user:${name.toLowerCase()}`];
  const wait = await lockedFor(db, keys, now);
  if (wait > 0) throw new HttpError(429, `尝试次数过多，请 ${Math.ceil(wait / 60_000)} 分钟后再试`);

  const user = await db
    .prepare('SELECT id, username, password_hash, disabled FROM users WHERE username = ?1 COLLATE NOCASE')
    .bind(name)
    .first<{ id: number; username: string; password_hash: string; disabled: number }>();
  const ok = await verifyPassword(pwd, user?.password_hash);
  if (!user || !ok) {
    await recordFailure(db, keys, now);
    throw new HttpError(401, '用户名或密码错误');
  }
  await clearFailures(db, keys);
  // 只有密码正确时才告知已停用，避免泄露账号状态
  if (user.disabled) throw new HttpError(403, '账号已停用，请联系管理员');
  return { username: user.username, token: await createSession(db, user.id, request, now) };
}

export async function logout(db: D1Like, session: Session): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?1').bind(session.id).run();
}

export async function changePassword(
  db: D1Like,
  session: Session,
  oldPassword: unknown,
  newPassword: unknown,
  now = Date.now(),
): Promise<void> {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > 256) {
    throw new HttpError(400, `新密码至少 ${MIN_PASSWORD} 位`);
  }
  const user = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?1')
    .bind(session.userId)
    .first<{ password_hash: string }>();
  if (!user || !(await verifyPassword(typeof oldPassword === 'string' ? oldPassword : '', user.password_hash))) {
    throw new HttpError(400, '原密码不正确');
  }
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3').bind(await hashPassword(newPassword), now, session.userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND id <> ?2').bind(session.userId, session.id),
  ]);
}

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
}

export async function listSessions(db: D1Like, session: Session, now = Date.now()): Promise<SessionInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT id, created_at, last_seen_at, user_agent FROM sessions
        WHERE user_id = ?1 AND expires_at > ?2 ORDER BY last_seen_at DESC`,
    )
    .bind(session.userId, now)
    .all<{ id: string; created_at: number; last_seen_at: number; user_agent: string | null }>();
  return results.map((r) => ({
    id: r.id,
    current: r.id === session.id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent ?? '',
  }));
}

export async function revokeSession(db: D1Like, session: Session, id: string): Promise<void> {
  if (id === session.id) throw new HttpError(400, '当前设备请使用「退出登录」');
  await db.prepare('DELETE FROM sessions WHERE id = ?1 AND user_id = ?2').bind(id, session.userId).run();
}
