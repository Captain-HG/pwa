import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onUnauthorized, setApiFetch } from '@/api/client';
import { db, LedgerDB } from '@/db/schema';
import { ensureSeed } from '@/db/seed';
import { wipeLocal } from '@/services/backup';
import { updateCategory } from '@/services/categories';
import { addTx, getTx, listByMonth, removeTx, updateTx } from '@/services/transactions';
import { applyRemote, collectChanges, countPending, syncNow, syncState } from '@/sync/sync';
import { createTestServer, postJson, type Client, type TestServer } from './helpers/testServer';
import { auth, loadMe, OWNER_KEY } from '@/stores/auth';
import { getSetting, setSetting } from '@/services/settings';

const oct = (d: number) => new Date(2026, 9, d, 12).getTime();

let server: TestServer;
let device: Client; // 本机
let other: Client; // 另一台设备（直接调接口）

beforeEach(async () => {
  await wipeLocal();
  await ensureSeed();
  server = await createTestServer();
  device = server.client();
  other = server.client();
  await device.login();
  await other.login();
  setApiFetch((p, init) => device.fetch(p, init));
  syncState.error = '';
});

const otherPush = (changes: unknown[]) => other.fetch('/api/sync/push', postJson({ changes })).then((r) => r.json());
const otherPull = () => other.fetch('/api/sync/pull?since=0').then((r) => r.json());

describe('变更追踪', () => {
  it('预置数据 updatedAt = 0 且不上传；本地写入自动标记', async () => {
    const cat = await db.categories.get('exp-food');
    expect(cat).toMatchObject({ updatedAt: 0, dirty: 0 });
    expect(await countPending()).toBe(0);

    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(1) });
    expect((await getTx(id))?.dirty).toBe(1);

    await syncNow();
    expect(await countPending()).toBe(0);

    await updateCategory('exp-food', { name: '吃饭' });
    const renamed = await db.categories.get('exp-food');
    expect(renamed?.dirty).toBe(1);
    expect(renamed?.updatedAt).toBeGreaterThan(0);
  });

  it('应用云端数据不会标记为待同步', async () => {
    await syncNow();
    await applyRemote([
      { entity: 'transactions', id: 'r1', updatedAt: 5, deleted: false, rev: 1, data: { id: 'r1', type: 'expense', amount: 1, categoryId: 'exp-food', accountId: 'default', occurredAt: oct(2), createdAt: 1, updatedAt: 5 } },
    ]);
    expect(await countPending()).toBe(0);
  });

  it('v1.0 本地库升级：已有数据全部待上传（Y07）', async () => {
    const name = 'upgrade-test';
    const old = new Dexie(name);
    old.version(1).stores({ transactions: 'id, occurredAt', categories: 'id, type, sort', accounts: 'id, sort', budgets: 'id, month', settings: 'key' });
    await old.table('transactions').add({ id: 't1', type: 'expense', amount: 5, occurredAt: 1, createdAt: 1, updatedAt: 7 });
    await old.table('categories').add({ id: 'exp-food', type: 'expense', name: '餐饮', sort: 0 });
    old.close();

    const upgraded = new LedgerDB(name);
    await upgraded.open();
    expect(await upgraded.transactions.get('t1')).toMatchObject({ dirty: 1, updatedAt: 7 });
    expect(await upgraded.categories.get('exp-food')).toMatchObject({ dirty: 1, updatedAt: 1 });
    upgraded.close();
    await Dexie.delete(name);
  });
});

describe('同步', () => {
  it('本机记账上传，另一台设备能拉到（Y01 / Y04）', async () => {
    const ids = [];
    for (let i = 1; i <= 3; i++) ids.push(await addTx({ type: 'expense', amount: i * 100, categoryId: 'exp-food', occurredAt: oct(i) }));
    expect(await countPending()).toBeGreaterThanOrEqual(3);
    await syncNow();
    expect(syncState.error).toBe('');
    expect(syncState.lastSyncAt).toBeTypeOf('number');
    expect(await countPending()).toBe(0);
    const remote = await otherPull();
    const txIds = remote.records.filter((r: { entity: string }) => r.entity === 'transactions').map((r: { id: string }) => r.id);
    expect(txIds.sort()).toEqual(ids.sort());
  });

  it('另一台设备的新增、修改、删除都会同步下来（Y02 / Y03）', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    await syncNow();
    const local = (await getTx(id))!;
    const { dirty: _d, ...data } = local;

    await otherPush([
      { entity: 'transactions', id, updatedAt: local.updatedAt + 1000, deleted: false, data: { ...data, amount: 999, updatedAt: local.updatedAt + 1000 } },
      { entity: 'transactions', id: 'from-pc', updatedAt: 1, deleted: false, data: { ...data, id: 'from-pc', amount: 50, updatedAt: 1 } },
    ]);
    await syncNow();
    expect((await getTx(id))?.amount).toBe(999);
    expect((await getTx('from-pc'))?.amount).toBe(50);

    await otherPush([{ entity: 'transactions', id: 'from-pc', updatedAt: 2, deleted: true, data: { ...data, id: 'from-pc', deleted: true, updatedAt: 2 } }]);
    await syncNow();
    expect(await getTx('from-pc')).toBeUndefined();
    expect((await listByMonth('2026-10')).map((t) => t.id)).toEqual([id]);
  });

  it('本地较新的未同步修改不会被云端旧数据覆盖', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    await syncNow();
    const local = (await getTx(id))!;
    const { dirty: _d, ...data } = local;
    // 另一台设备基于旧版本修改（时间更早）
    await otherPush([{ entity: 'transactions', id, updatedAt: local.updatedAt + 1, deleted: false, data: { ...data, amount: 1, updatedAt: local.updatedAt + 1 } }]);
    await new Promise((r) => setTimeout(r, 5));
    await updateTx(id, { type: 'expense', amount: 777, categoryId: 'exp-food', occurredAt: oct(5) });
    await syncNow();
    expect((await getTx(id))?.amount).toBe(777);
    const remote = (await otherPull()).records.find((r: { id: string }) => r.id === id);
    expect(remote.data.amount).toBe(777);
  });

  it('新设备的预置分类不会覆盖云端已改名的分类（Y06）', async () => {
    await otherPush([
      { entity: 'categories', id: 'exp-food', updatedAt: 100, deleted: false, data: { id: 'exp-food', type: 'expense', name: '吃饭', icon: '🍚', color: '#000', sort: 0, hidden: false, updatedAt: 100 } },
    ]);
    expect((await db.categories.get('exp-food'))?.name).toBe('餐饮');
    await syncNow();
    expect((await db.categories.get('exp-food'))?.name).toBe('吃饭');
    const remote = (await otherPull()).records.find((r: { id: string }) => r.id === 'exp-food');
    expect(remote.data.name).toBe('吃饭');
  });

  it('推送期间被再次修改的记录保持待同步（Y05）', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    let edited = false;
    setApiFetch(async (p, init) => {
      const res = await device.fetch(p, init);
      if (p === '/api/sync/push' && !edited) {
        edited = true;
        await new Promise((r) => setTimeout(r, 5));
        await updateTx(id, { type: 'expense', amount: 200, categoryId: 'exp-food', occurredAt: oct(5) });
      }
      return res;
    });
    await syncNow();
    // 同一轮里补跑或下一轮会推上去；最终云端是 200
    await syncNow();
    expect(await countPending()).toBe(0);
    const remote = (await otherPull()).records.find((r: { id: string }) => r.id === id);
    expect(remote.data.amount).toBe(200);
  });

  it('删除同步到云端（Y03）', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    await syncNow();
    await removeTx(id);
    expect((await collectChanges()).map((c) => c.id)).toContain(id);
    await syncNow();
    const remote = (await otherPull()).records.find((r: { id: string }) => r.id === id);
    expect(remote.deleted).toBe(true);
  });

  it('分页拉取大量数据', async () => {
    const base = { type: 'expense', amount: 1, categoryId: 'exp-food', accountId: 'default', occurredAt: oct(3), createdAt: 1, updatedAt: 1 };
    for (let page = 0; page < 2; page++) {
      const changes = Array.from({ length: 400 }, (_, i) => {
        const id = `bulk-${page}-${i}`;
        return { entity: 'transactions', id, updatedAt: 1, deleted: false, data: { ...base, id } };
      });
      expect((await otherPush(changes)).applied).toBe(400);
    }
    await syncNow();
    expect(await listByMonth('2026-10')).toHaveLength(800);
  });

  it('会话失效时触发本机登出；离线时记录错误', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    device.cookie = '';
    await syncNow();
    expect(handler).toHaveBeenCalled();
    expect(syncState.error).toContain('登录已失效');

    setApiFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await syncNow();
    expect(syncState.error).toBe('网络不可用，稍后重试');
    onUnauthorized(() => {});
  });
});

describe('本机数据归属（P13）', () => {
  it('首次记录归属时保留本机数据', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    await loadMe();
    expect(auth.me?.username).toBe('me');
    expect(await getSetting(OWNER_KEY)).toBe(auth.me?.id);
    expect(await getTx(id)).toBeDefined();
  });

  it('登录用户与本机数据主人不同时，先清空本机', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(5) });
    await setSetting(OWNER_KEY, 999);
    await loadMe();
    expect(await getTx(id)).toBeUndefined();
    expect(await countPending()).toBe(0);
    expect(await db.categories.count()).toBe((await import('@/db/seed')).presetCategories().length);
    expect(await getSetting(OWNER_KEY)).toBe(auth.me?.id);
  });
});
