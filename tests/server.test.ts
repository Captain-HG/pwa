import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../server/crypto';
import { createTestServer, ORIGIN, postJson, USER } from './helpers/testServer';

const DAY = 86_400_000;

describe('密码哈希', () => {
  it('校验正确与错误密码', async () => {
    const h = await hashPassword('abc12345', 1000);
    expect(h).toMatch(/^pbkdf2_sha256\$1000\$/);
    expect(await verifyPassword('abc12345', h)).toBe(true);
    expect(await verifyPassword('abc12346', h)).toBe(false);
    expect(await verifyPassword('abc12345', null)).toBe(false);
    expect(await verifyPassword('abc12345', 'garbage')).toBe(false);
  });

  it('兼容 scripts/create_user.py 生成的哈希', async () => {
    const fromPython = 'pbkdf2_sha256$1000$AAECAwQFBgcICQoLDA0ODw==$A8kbRH6CZ/R1UE8nJZGxOID4vnGmTE8AePBbYBTObX8=';
    expect(await verifyPassword('py-pass-123', fromPython)).toBe(true);
    expect(await verifyPassword('py-pass-12', fromPython)).toBe(false);
  });
});

describe('访问控制（A01 / A02）', () => {
  it('未登录：页面跳登录页，接口 401，公开文件放行', async () => {
    const c = (await createTestServer()).client();
    const home = await c.fetch('/');
    expect(home.status).toBe(302);
    expect(home.headers.get('Location')).toBe('/login');
    expect((await c.fetch('/assets/index.js')).status).toBe(302);
    // sw.js 不能重定向：返回自我注销脚本，让旧版本能更新并回到登录页
    const sw = await c.fetch('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers.get('Content-Type')).toContain('javascript');
    const swText = await sw.text();
    expect(swText).toContain('registration.unregister()');
    expect(swText).toContain('caches.delete');
    expect((await c.fetch('/api/sync/pull')).status).toBe(401);
    const login = await c.fetch('/login');
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('<form');
    expect(await (await c.fetch('/manifest.webmanifest')).text()).toBe('static');
  });

  it('登录后可访问页面与接口；/login 跳回首页（A05）', async () => {
    const c = (await createTestServer()).client();
    const res = await c.login();
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/__Host-sid=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000/);
    expect(await (await c.fetch('/')).text()).toBe('static');
    expect(await (await c.fetch('/sw.js')).text()).toBe('static');
    expect(await (await c.fetch('/api/auth/me')).json()).toMatchObject({ username: USER.username, role: '管理员', permissions: ['*'] });
    expect((await c.fetch('/login')).headers.get('Location')).toBe('/');
  });
});

describe('登录', () => {
  it('错误时不区分用户名还是密码（A03）', async () => {
    const s = await createTestServer();
    const a = await s.client().login('wrong-password');
    expect(a.status).toBe(401);
    expect((await a.json()).error).toBe('用户名或密码错误');
    const b = await s.client().fetch('/api/auth/login', postJson({ username: 'nobody', password: 'whatever1' }));
    expect(b.status).toBe(401);
    expect((await b.json()).error).toBe('用户名或密码错误');
  });

  it('连续失败 5 次锁定 15 分钟，期满后恢复（A04）', async () => {
    const s = await createTestServer();
    const c = s.client();
    for (let i = 0; i < 5; i++) expect((await c.login('bad-pass')).status).toBe(401);
    const locked = await c.login();
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toContain('15 分钟');
    s.now.value += 15 * 60_000 + 1;
    expect((await c.login()).status).toBe(200);
  });

  it('成功登录会清零失败计数', async () => {
    const s = await createTestServer();
    const c = s.client();
    for (let i = 0; i < 4; i++) await c.login('bad-pass');
    expect((await c.login()).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await c.login('bad-pass')).status).toBe(401);
  });
});

describe('CSRF（A09）', () => {
  it('跨站 Origin 与非 JSON 的写请求被拒绝', async () => {
    const c = (await createTestServer()).client();
    await c.login();
    const cross = await c.fetch('/api/auth/logout', { ...postJson({}), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } });
    expect(cross.status).toBe(403);
    const form = await c.fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    expect(form.status).toBe(403);
    const crossLogin = await c.fetch('/api/auth/login', { ...postJson(USER), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } });
    expect(crossLogin.status).toBe(403);
  });
});

describe('会话', () => {
  it('设备列表、移除其他设备、不能移除本机（A06）', async () => {
    const s = await createTestServer();
    const phone = s.client();
    const pc = s.client();
    await phone.login();
    await pc.login();
    const { sessions } = await (await phone.fetch('/api/auth/sessions')).json();
    expect(sessions).toHaveLength(2);
    const self = sessions.find((x: { current: boolean }) => x.current);
    const other = sessions.find((x: { current: boolean }) => !x.current);
    expect((await phone.fetch(`/api/auth/sessions/${self.id}`, { method: 'DELETE' })).status).toBe(400);
    expect((await phone.fetch(`/api/auth/sessions/${other.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await pc.fetch('/api/auth/me')).status).toBe(401);
    expect((await phone.fetch('/api/auth/me')).status).toBe(200);
  });

  it('修改密码：原密码错误报错；成功后其他设备下线（A07）', async () => {
    const s = await createTestServer();
    const phone = s.client();
    const pc = s.client();
    await phone.login();
    await pc.login();
    const bad = await phone.fetch('/api/auth/password', postJson({ oldPassword: 'nope', newPassword: 'new-password-1' }));
    expect(bad.status).toBe(400);
    const short = await phone.fetch('/api/auth/password', postJson({ oldPassword: USER.password, newPassword: 'short' }));
    expect(short.status).toBe(400);
    const ok = await phone.fetch('/api/auth/password', postJson({ oldPassword: USER.password, newPassword: 'new-password-1' }));
    expect(ok.status).toBe(200);
    expect((await pc.fetch('/api/auth/me')).status).toBe(401);
    expect((await phone.fetch('/api/auth/me')).status).toBe(200);
    expect((await s.client().login()).status).toBe(401);
    expect((await s.client().login('new-password-1')).status).toBe(200);
  });

  it('退出登录后会话失效（A08）', async () => {
    const c = (await createTestServer()).client();
    await c.login();
    const sid = c.cookie;
    const res = await c.fetch('/api/auth/logout', postJson({}));
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    c.cookie = sid; // 即使保留旧 Cookie 也无效
    expect((await c.fetch('/api/auth/me')).status).toBe(401);
  });

  it('剩余有效期不足 60 天时自动续期；过期后失效', async () => {
    const s = await createTestServer();
    const c = s.client();
    await c.login();
    s.now.value += 10 * DAY;
    expect((await c.fetch('/api/auth/me')).headers.get('Set-Cookie')).toBeNull();
    s.now.value += 25 * DAY;
    const renewed = await c.fetch('/api/auth/me');
    expect(renewed.headers.get('Set-Cookie')).toContain('Max-Age=7776000');
    s.now.value += 89 * DAY;
    expect((await c.fetch('/api/auth/me')).status).toBe(200);
    s.now.value += 91 * DAY;
    expect((await c.fetch('/api/auth/me')).status).toBe(401);
  });
});

describe('同步接口', () => {
  const tx = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
    entity: 'transactions',
    id,
    updatedAt,
    deleted: false,
    data: { id, amount: 100, updatedAt, ...extra },
  });

  it('推送、增量拉取、后写入者胜（Y10）', async () => {
    const c = (await createTestServer()).client();
    await c.login();
    const push = (changes: unknown[]) => c.fetch('/api/sync/push', postJson({ changes })).then((r) => r.json());
    const pull = (since: number, limit = 500) => c.fetch(`/api/sync/pull?since=${since}&limit=${limit}`).then((r) => r.json());

    expect(await push([tx('a', 10), tx('b', 10)])).toEqual({ applied: 2 });
    const first = await pull(0);
    expect(first.records.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
    expect(first.cursor).toBe(2);
    expect(first.hasMore).toBe(false);

    expect(await push([tx('a', 5, { amount: 1 })])).toEqual({ applied: 0 });
    expect((await pull(2)).records).toHaveLength(0);

    expect(await push([tx('a', 20, { amount: 999 })])).toEqual({ applied: 1 });
    const next = await pull(2);
    expect(next.records).toHaveLength(1);
    expect(next.records[0]).toMatchObject({ id: 'a', rev: 3, updatedAt: 20, data: { amount: 999 } });

    const paged = await pull(0, 1);
    expect(paged).toMatchObject({ cursor: 2, hasMore: true });
  });

  it('非法数据返回 400 且不写入', async () => {
    const c = (await createTestServer()).client();
    await c.login();
    const bad = [
      { changes: 'x' },
      { changes: [{ ...tx('a', 1), entity: 'users' }] },
      { changes: [{ ...tx('a', 1), data: { id: 'other' } }] },
      { changes: [tx('a', 1), { ...tx('b', 1), updatedAt: 'x' }] },
      { changes: [{ ...tx('a', 1), data: { id: 'a', note: 'x'.repeat(20_000) } }] },
    ];
    for (const body of bad) expect((await c.fetch('/api/sync/push', postJson(body))).status).toBe(400);
    expect((await (await c.fetch('/api/sync/pull')).json()).records).toHaveLength(0);
    expect((await c.fetch('/api/sync/pull?since=-1')).status).toBe(400);
  });

  it('不同 Origin 不影响 GET', async () => {
    const c = (await createTestServer()).client();
    await c.login();
    expect((await c.fetch('/api/sync/pull', { headers: { Origin: ORIGIN } })).status).toBe(200);
  });
});
