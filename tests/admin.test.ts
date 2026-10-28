import { describe, expect, it } from 'vitest';
import { can, canAny, normalize, routePermissions } from '../shared/permissions';
import { createTestServer, postJson, type Client } from './helpers/testServer';

const patchJson = (body: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function setup() {
  const s = await createTestServer();
  const admin = s.client();
  await admin.login();
  const me = await (await admin.fetch('/api/auth/me')).json();
  return { s, admin, adminId: me.id as number };
}

async function createUser(admin: Client, username: string, roleId: number, password = 'member-pass-1') {
  const res = await admin.fetch('/api/admin/users', postJson({ username, displayName: username.toUpperCase(), password, roleId }));
  expect(res.status).toBe(200);
  return (await res.json()).id as number;
}

const tx = (id: string) => ({
  entity: 'transactions',
  id,
  updatedAt: 1,
  deleted: false,
  data: { id, amount: 1, updatedAt: 1 },
});

describe('权限模块', () => {
  it('normalize 补齐前置权限、去掉未知项和 *', () => {
    expect(normalize(['backup.import', 'x', '*', 'stats.view'])).toEqual(['ledger.view', 'ledger.edit', 'stats.view', 'backup.import']);
  });

  it('can / 路由权限', () => {
    expect(can(['*'], 'admin.users')).toBe(true);
    expect(can(['ledger.view'], 'ledger.edit')).toBe(false);
    expect(routePermissions('/edit/abc')).toEqual(['ledger.edit']);
    expect(routePermissions('/settings')).toEqual([]);
    expect(canAny([], routePermissions('/account'))).toBe(true);
    expect(canAny(['stats.view'], routePermissions('/'))).toBe(false);
  });
});

describe('用户管理', () => {
  it('升级后的原账号是管理员（P01），新建用户可登录且账本独立（P02 / P14）', async () => {
    const { s, admin } = await setup();
    await admin.fetch('/api/sync/push', postJson({ changes: [tx('admin-tx')] }));

    await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    expect((await ming.login()).status).toBe(200);
    const me = await (await ming.fetch('/api/auth/me')).json();
    expect(me).toMatchObject({ username: 'xiaoming', displayName: 'XIAOMING', role: '普通成员' });

    expect((await (await ming.fetch('/api/sync/pull')).json()).records).toHaveLength(0);
    await ming.fetch('/api/sync/push', postJson({ changes: [tx('ming-tx')] }));
    const adminRecords = (await (await admin.fetch('/api/sync/pull')).json()).records.map((r: { id: string }) => r.id);
    expect(adminRecords).toEqual(['admin-tx']);
  });

  it('用户名重复（不区分大小写）、格式错误、密码太短（P15）', async () => {
    const { admin } = await setup();
    await createUser(admin, 'xiaoming', 2);
    const cases: [Record<string, unknown>, string][] = [
      [{ username: 'XiaoMing', password: 'member-pass-1', roleId: 2 }, '已存在'],
      [{ username: 'bad name', password: 'member-pass-1', roleId: 2 }, '用户名'],
      [{ username: 'ok', password: 'short', roleId: 2 }, '密码'],
      [{ username: 'ok', password: 'member-pass-1', roleId: 99 }, '角色不存在'],
    ];
    for (const [body, msg] of cases) {
      const res = await admin.fetch('/api/admin/users', postJson(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(msg);
    }
  });

  it('普通成员不能调用管理接口（P06）', async () => {
    const { s, admin } = await setup();
    await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    expect((await ming.fetch('/api/admin/users')).status).toBe(403);
    expect((await ming.fetch('/api/admin/roles')).status).toBe(403);
    expect((await ming.fetch('/api/admin/users', postJson({ username: 'x', password: 'xxxxxxxx', roleId: 1 }))).status).toBe(403);
  });

  it('停用：设备立即下线，再登录提示已停用；启用后恢复（P07）', async () => {
    const { s, admin } = await setup();
    const id = await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    expect((await admin.fetch(`/api/admin/users/${id}`, patchJson({ disabled: true }))).status).toBe(200);
    expect((await ming.fetch('/api/auth/me')).status).toBe(401);
    const again = await ming.login();
    expect(again.status).toBe(403);
    expect((await again.json()).error).toContain('已停用');
    // 密码错误时不暴露停用状态
    expect((await (await ming.login('wrong-pass')).json()).error).toBe('用户名或密码错误');
    await admin.fetch(`/api/admin/users/${id}`, patchJson({ disabled: false }));
    expect((await ming.login()).status).toBe(200);
  });

  it('重置密码：旧会话失效，新密码可登录（P08）', async () => {
    const { s, admin } = await setup();
    const id = await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    expect((await admin.fetch(`/api/admin/users/${id}/password`, postJson({ password: 'new-pass-123' }))).status).toBe(200);
    expect((await ming.fetch('/api/auth/me')).status).toBe(401);
    expect((await ming.login()).status).toBe(401);
    expect((await ming.login('new-pass-123')).status).toBe(200);
  });

  it('删除用户：会话与云端账目一并删除（P12）', async () => {
    const { s, admin } = await setup();
    const id = await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    await ming.fetch('/api/sync/push', postJson({ changes: [tx('ming-tx')] }));
    expect((await admin.fetch(`/api/admin/users/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await ming.fetch('/api/auth/me')).status).toBe(401);
    const left = await s.db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?1').bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await (await admin.fetch('/api/admin/users')).json()).users.map((u: { username: string }) => u.username)).toEqual(['me']);
  });

  it('保护规则：不能对自己停用/删除/改角色；至少保留一个管理员（P11）', async () => {
    const { s, admin, adminId } = await setup();
    for (const res of [
      await admin.fetch(`/api/admin/users/${adminId}`, patchJson({ disabled: true })),
      await admin.fetch(`/api/admin/users/${adminId}`, patchJson({ roleId: 2 })),
      await admin.fetch(`/api/admin/users/${adminId}`, { method: 'DELETE' }),
    ]) {
      expect(res.status).toBe(400);
    }
    // 自己的显示名可以改
    expect((await admin.fetch(`/api/admin/users/${adminId}`, patchJson({ displayName: '老板' }))).status).toBe(200);

    // 第二个管理员可以降级第一个；但不能把最后一个管理员降级
    const id2 = await createUser(admin, 'admin2', 1);
    const a2 = s.client('admin2', 'member-pass-1');
    await a2.login();
    expect((await a2.fetch(`/api/admin/users/${adminId}`, patchJson({ roleId: 2 }))).status).toBe(200);
    const last = await admin.fetch(`/api/admin/users/${id2}`, patchJson({ roleId: 2 }));
    expect(last.status).toBe(403); // admin 已被降级为普通成员，没有管理权限
    const self = await a2.fetch(`/api/admin/users/${id2}`, patchJson({ roleId: 2 }));
    expect(self.status).toBe(400);
  });
});

describe('最后一个管理员', () => {
  it('拥有用户管理权限的非管理员，不能停用、降级或删除唯一的管理员（P11）', async () => {
    const { s, admin, adminId } = await setup();
    const roleId = (await (await admin.fetch('/api/admin/roles', postJson({ name: '运维', permissions: ['admin.users'] }))).json()).id;
    await createUser(admin, 'ops', roleId);
    const ops = s.client('ops', 'member-pass-1');
    await ops.login();
    for (const res of [
      await ops.fetch(`/api/admin/users/${adminId}`, patchJson({ disabled: true })),
      await ops.fetch(`/api/admin/users/${adminId}`, patchJson({ roleId: 2 })),
      await ops.fetch(`/api/admin/users/${adminId}`, { method: 'DELETE' }),
    ]) {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('至少需要保留一个启用中的管理员');
    }
    // 没有角色管理权限，不能改角色
    expect((await ops.fetch(`/api/admin/roles/${roleId}`, patchJson({ permissions: ['admin.roles'] }))).status).toBe(403);
  });
});

describe('角色管理', () => {
  it('自定义只读角色：可拉取不可推送，不能访问管理接口（P03 / P05）', async () => {
    const { s, admin } = await setup();
    const res = await admin.fetch('/api/admin/roles', postJson({ name: '只读', permissions: ['ledger.view', 'stats.view'] }));
    expect(res.status).toBe(200);
    const roleId = (await res.json()).id;
    await createUser(admin, 'mom', roleId);
    const mom = s.client('mom', 'member-pass-1');
    await mom.login();
    expect((await (await mom.fetch('/api/auth/me')).json()).permissions).toEqual(['ledger.view', 'stats.view']);
    expect((await mom.fetch('/api/sync/pull')).status).toBe(200);
    expect((await mom.fetch('/api/sync/push', postJson({ changes: [tx('x')] }))).status).toBe(403);
    const cat = { entity: 'categories', id: 'c1', updatedAt: 1, deleted: false, data: { id: 'c1' } };
    expect((await mom.fetch('/api/sync/push', postJson({ changes: [cat] }))).status).toBe(403);
  });

  it('修改角色权限立即生效（P09）', async () => {
    const { s, admin } = await setup();
    const roleId = (await (await admin.fetch('/api/admin/roles', postJson({ name: '只读', permissions: ['ledger.view'] }))).json()).id;
    await createUser(admin, 'mom', roleId);
    const mom = s.client('mom', 'member-pass-1');
    await mom.login();
    expect((await mom.fetch('/api/sync/push', postJson({ changes: [tx('x')] }))).status).toBe(403);
    await admin.fetch(`/api/admin/roles/${roleId}`, patchJson({ permissions: ['ledger.edit'] }));
    expect((await (await mom.fetch('/api/auth/me')).json()).permissions).toEqual(['ledger.view', 'ledger.edit']);
    expect((await mom.fetch('/api/sync/push', postJson({ changes: [tx('x')] }))).status).toBe(200);
  });

  it('不能修改管理员角色；不能删除预置或使用中的角色；名称不能重复（P10）', async () => {
    const { admin } = await setup();
    expect((await admin.fetch('/api/admin/roles/1', patchJson({ permissions: ['ledger.view'] }))).status).toBe(400);
    expect((await admin.fetch('/api/admin/roles/2', { method: 'DELETE' })).status).toBe(400);
    expect((await admin.fetch('/api/admin/roles', postJson({ name: '普通成员', permissions: [] }))).status).toBe(400);
    // 自定义角色不能拿到 '*'
    const r = await admin.fetch('/api/admin/roles', postJson({ name: '伪管理员', permissions: ['*'] }));
    const id = (await r.json()).id;
    const roles = (await (await admin.fetch('/api/admin/roles')).json()).roles;
    expect(roles.find((x: { id: number }) => x.id === id).permissions).toEqual([]);

    await createUser(admin, 'kid', id);
    const del = await admin.fetch(`/api/admin/roles/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect((await del.json()).error).toContain('1 个用户');
  });

  it('普通成员不能修改角色权限给自己提权', async () => {
    const { s, admin } = await setup();
    await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    expect((await ming.fetch('/api/admin/roles/2', patchJson({ permissions: ['admin.users'] }))).status).toBe(403);
  });
});

describe('账单导入权限（I11）', () => {
  const rule = { entity: 'rules', id: 'rule-1', updatedAt: 1, deleted: false, data: { id: 'rule-1', keyword: 'x', categoryId: 'exp-food' } };

  it('迁移后普通成员拥有 bill.import，可以推送规则', async () => {
    const { s, admin } = await setup();
    await createUser(admin, 'xiaoming', 2);
    const ming = s.client('xiaoming', 'member-pass-1');
    await ming.login();
    const me = await (await ming.fetch('/api/auth/me')).json();
    expect(me.permissions).toContain('bill.import');
    expect((await ming.fetch('/api/sync/push', postJson({ changes: [rule] }))).status).toBe(200);
  });

  it('没有 bill.import / category.manage 的角色不能推送规则', async () => {
    const { s, admin } = await setup();
    const roleId = (await (await admin.fetch('/api/admin/roles', postJson({ name: '只记账', permissions: ['ledger.edit'] }))).json()).id;
    await createUser(admin, 'mom', roleId);
    const mom = s.client('mom', 'member-pass-1');
    await mom.login();
    expect((await mom.fetch('/api/sync/push', postJson({ changes: [rule] }))).status).toBe(403);
    expect(routePermissions('/import')).toEqual(['bill.import']);
  });
});
