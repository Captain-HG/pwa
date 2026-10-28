import { ALL, normalize } from '../shared/permissions';
import { parsePermissions } from './auth';
import { hashPassword } from './crypto';
import { HttpError } from './http';
import type { D1Like, Session } from './types';

export const USERNAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;
export const MIN_PASSWORD = 8;

// ---------- 角色 ----------

export interface RoleInfo {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  builtin: boolean;
  userCount: number;
}

interface RoleRow {
  id: number;
  name: string;
  description: string;
  permissions: string;
  builtin: number;
  user_count: number;
}

export async function listRoles(db: D1Like): Promise<RoleInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.name, r.description, r.permissions, r.builtin,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
         FROM roles r ORDER BY r.id`,
    )
    .all<RoleRow>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: parsePermissions(r.permissions),
    builtin: r.builtin === 1,
    userCount: r.user_count,
  }));
}

async function getRole(db: D1Like, id: unknown): Promise<RoleInfo> {
  const role = (await listRoles(db)).find((r) => r.id === id);
  if (!role) throw new HttpError(400, '角色不存在');
  return role;
}

function checkRoleName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > 20) throw new HttpError(400, '角色名称需为 1–20 个字');
  return n;
}

function checkDescription(d: unknown): string {
  const s = typeof d === 'string' ? d.trim() : '';
  if (s.length > 60) throw new HttpError(400, '说明不能超过 60 个字');
  return s;
}

function checkPermissions(p: unknown): string[] {
  if (!Array.isArray(p)) throw new HttpError(400, '权限格式错误');
  return normalize(p);
}

async function assertRoleNameFree(db: D1Like, name: string, selfId?: number): Promise<void> {
  const dup = await db.prepare('SELECT id FROM roles WHERE name = ?1').bind(name).first<{ id: number }>();
  if (dup && dup.id !== selfId) throw new HttpError(400, '角色名称已存在');
}

export async function createRole(db: D1Like, body: Record<string, unknown>, now = Date.now()): Promise<number> {
  const name = checkRoleName(body.name);
  await assertRoleNameFree(db, name);
  await db
    .prepare('INSERT INTO roles (name, description, permissions, builtin, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?4)')
    .bind(name, checkDescription(body.description), JSON.stringify(checkPermissions(body.permissions)), now)
    .run();
  const row = await db.prepare('SELECT id FROM roles WHERE name = ?1').bind(name).first<{ id: number }>();
  return row!.id;
}

export async function updateRole(db: D1Like, id: number, body: Record<string, unknown>, now = Date.now()): Promise<void> {
  const role = await getRole(db, id);
  if (role.permissions.includes(ALL)) throw new HttpError(400, '管理员角色不能修改');
  const name = body.name !== undefined ? checkRoleName(body.name) : role.name;
  if (name !== role.name) await assertRoleNameFree(db, name, id);
  const description = body.description !== undefined ? checkDescription(body.description) : role.description;
  const permissions = body.permissions !== undefined ? checkPermissions(body.permissions) : role.permissions;
  await db
    .prepare('UPDATE roles SET name = ?1, description = ?2, permissions = ?3, updated_at = ?4 WHERE id = ?5')
    .bind(name, description, JSON.stringify(permissions), now, id)
    .run();
}

export async function deleteRole(db: D1Like, id: number): Promise<void> {
  const role = await getRole(db, id);
  if (role.builtin) throw new HttpError(400, '预置角色不能删除');
  if (role.userCount > 0) throw new HttpError(400, `还有 ${role.userCount} 个用户使用该角色，请先调整他们的角色`);
  await db.prepare('DELETE FROM roles WHERE id = ?1 AND builtin = 0').bind(id).run();
}

// ---------- 用户 ----------

export interface UserInfo {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  disabled: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export async function listUsers(db: D1Like): Promise<UserInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role_id, r.name AS role_name, u.disabled, u.created_at,
              (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        ORDER BY u.id`,
    )
    .all<{
      id: number;
      username: string;
      display_name: string;
      role_id: number;
      role_name: string | null;
      disabled: number;
      created_at: number;
      last_seen_at: number | null;
    }>();
  return results.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    roleId: u.role_id,
    roleName: u.role_name ?? '（角色已删除）',
    disabled: u.disabled === 1,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
  }));
}

function checkDisplayName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > 20) throw new HttpError(400, '显示名不能超过 20 个字');
  return s;
}

function checkPassword(v: unknown): string {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD || v.length > 256) {
    throw new HttpError(400, `密码至少 ${MIN_PASSWORD} 位`);
  }
  return v;
}

/** 启用中且角色拥有全部权限的用户数 */
async function activeAdminIds(db: D1Like): Promise<number[]> {
  const users = await listUsers(db);
  const roles = new Map((await listRoles(db)).map((r) => [r.id, r]));
  return users.filter((u) => !u.disabled && roles.get(u.roleId)?.permissions.includes(ALL)).map((u) => u.id);
}

async function assertKeepsAnAdmin(db: D1Like, userId: number): Promise<void> {
  const admins = await activeAdminIds(db);
  if (admins.includes(userId) && admins.length <= 1) throw new HttpError(400, '至少需要保留一个启用中的管理员');
}

async function getUser(db: D1Like, id: number): Promise<UserInfo> {
  const user = (await listUsers(db)).find((u) => u.id === id);
  if (!user) throw new HttpError(404, '用户不存在');
  return user;
}

export async function createUser(db: D1Like, body: Record<string, unknown>, now = Date.now()): Promise<number> {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!USERNAME_RE.test(username)) throw new HttpError(400, '用户名只能包含字母、数字、_ . -，长度 1–32');
  const dup = await db.prepare('SELECT id FROM users WHERE username = ?1 COLLATE NOCASE').bind(username).first();
  if (dup) throw new HttpError(400, '用户名已存在');
  const role = await getRole(db, body.roleId);
  const hash = await hashPassword(checkPassword(body.password));
  await db
    .prepare(
      `INSERT INTO users (username, password_hash, role_id, display_name, disabled, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
    )
    .bind(username, hash, role.id, checkDisplayName(body.displayName), now)
    .run();
  const row = await db.prepare('SELECT id FROM users WHERE username = ?1').bind(username).first<{ id: number }>();
  return row!.id;
}

export async function updateUser(
  db: D1Like,
  actor: Session,
  id: number,
  body: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  const user = await getUser(db, id);
  const self = id === actor.userId;
  const displayName = body.displayName !== undefined ? checkDisplayName(body.displayName) : user.displayName;

  let roleId = user.roleId;
  if (body.roleId !== undefined && body.roleId !== user.roleId) {
    if (self) throw new HttpError(400, '不能修改自己的角色');
    const role = await getRole(db, body.roleId);
    if (!role.permissions.includes(ALL)) await assertKeepsAnAdmin(db, id);
    roleId = role.id;
  }

  let disabled = user.disabled;
  if (body.disabled !== undefined && Boolean(body.disabled) !== user.disabled) {
    if (self) throw new HttpError(400, '不能停用自己');
    if (body.disabled) await assertKeepsAnAdmin(db, id);
    disabled = Boolean(body.disabled);
  }

  const stmts = [
    db
      .prepare('UPDATE users SET display_name = ?1, role_id = ?2, disabled = ?3, updated_at = ?4 WHERE id = ?5')
      .bind(displayName, roleId, disabled ? 1 : 0, now, id),
  ];
  if (disabled) stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id));
  await db.batch(stmts);
}

export async function resetUserPassword(db: D1Like, id: number, password: unknown, now = Date.now()): Promise<void> {
  await getUser(db, id);
  const hash = await hashPassword(checkPassword(password));
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3').bind(hash, now, id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
  ]);
}

export async function deleteUser(db: D1Like, actor: Session, id: number): Promise<void> {
  if (id === actor.userId) throw new HttpError(400, '不能删除自己');
  const user = await getUser(db, id);
  await assertKeepsAnAdmin(db, id);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM records WHERE user_id = ?1').bind(id),
    db.prepare('DELETE FROM login_attempts WHERE key = ?1').bind(`user:${user.username.toLowerCase()}`),
    db.prepare('DELETE FROM users WHERE id = ?1').bind(id),
  ]);
}
