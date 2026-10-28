import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { DEFAULT_ACCOUNT_ID, ensureSeed, presetCategories } from '@/db/seed';
import { childrenOf, descendantIds, fullName, rootOf, topLevel } from '@/domain/category';
import { addTx, getTx, listByMonth, removeTx, updateTx } from '@/services/transactions';
import { createCategory, listCategories, moveCategory, updateCategory } from '@/services/categories';
import {
  buildBackup,
  exportCsvBlob,
  importBackup,
  INVALID_BACKUP,
  parseBackup,
  clearAllTransactions,
  wipeLocal,
} from '@/services/backup';

async function resetAll() {
  await wipeLocal();
  await ensureSeed();
}

const oct = (d: number) => new Date(2026, 9, d, 12).getTime();

beforeEach(async () => {
  await resetAll();
});

describe('初始化（F01）', () => {
  it('写入预置分类和默认账户', async () => {
    const presets = presetCategories();
    expect(await listCategories('expense')).toHaveLength(presets.filter((c) => c.type === 'expense').length);
    expect(await listCategories('income')).toHaveLength(presets.filter((c) => c.type === 'income').length);
    expect(presets.filter((c) => !c.parentId && c.type === 'expense').map((c) => c.name)).toContain('保险');
    expect(await db.accounts.get(DEFAULT_ACCOUNT_ID)).toBeTruthy();
  });
});

describe('流水', () => {
  it('增改删（F02 / F07 / F08 / F09）', async () => {
    const id = await addTx({ type: 'expense', amount: 2800, categoryId: 'exp-food', occurredAt: oct(27), note: ' 午饭 ' });
    let tx = await getTx(id);
    expect(tx?.note).toBe('午饭');
    expect(tx?.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(await listByMonth('2026-10')).toHaveLength(1);

    await updateTx(id, { type: 'expense', amount: 3000, categoryId: 'exp-traffic', occurredAt: new Date(2026, 8, 30).getTime() });
    tx = await getTx(id);
    expect(tx?.amount).toBe(3000);
    expect(tx?.note).toBeUndefined();
    expect(await listByMonth('2026-10')).toHaveLength(0);
    expect(await listByMonth('2026-09')).toHaveLength(1);

    await removeTx(id);
    expect(await getTx(id)).toBeUndefined();
    expect(await listByMonth('2026-09')).toHaveLength(0);
  });

  it('金额校验（F05）', async () => {
    await expect(addTx({ type: 'expense', amount: 0, categoryId: 'exp-food', occurredAt: oct(1) })).rejects.toThrow('请输入金额');
    await expect(addTx({ type: 'expense', amount: 1.5, categoryId: 'exp-food', occurredAt: oct(1) })).rejects.toThrow();
  });
});

describe('分类（F11 / F12 / D11）', () => {
  const tops = async () => topLevel(await listCategories('expense'));

  it('新增、重名、隐藏、同级排序', async () => {
    const id = await createCategory({ type: 'expense', name: '咖啡', icon: '☕' });
    let list = await tops();
    expect(list[list.length - 1].id).toBe(id);
    await expect(createCategory({ type: 'expense', name: '咖啡', icon: '☕' })).rejects.toThrow('已存在');
    // 不同类型可以同名
    await createCategory({ type: 'income', name: '咖啡', icon: '☕' });

    await updateCategory('exp-gift', { hidden: true });
    expect((await listCategories('expense', false)).some((c) => c.id === 'exp-gift')).toBe(false);

    await moveCategory(id, 'up');
    list = await tops();
    expect(list[list.length - 2].id).toBe(id);
    await moveCategory('exp-food', 'up'); // 已在最前，不变
    expect((await tops())[0].id).toBe('exp-food');
  });

  it('子分类：继承颜色、同级内重名校验与排序、只支持两级', async () => {
    const all = await listCategories('expense');
    const kids = childrenOf('exp-traffic', all);
    expect(kids.map((c) => c.name)).toContain('充电');
    const id = await createCategory({ type: 'expense', name: '高铁', icon: '🚄', parentId: 'exp-traffic' });
    const created = (await listCategories()).find((c) => c.id === id)!;
    expect(created).toMatchObject({ parentId: 'exp-traffic', color: all.find((c) => c.id === 'exp-traffic')!.color });
    await expect(createCategory({ type: 'expense', name: '充电', icon: '🔌', parentId: 'exp-traffic' })).rejects.toThrow('已存在');
    // 不同上级下可以同名
    await createCategory({ type: 'expense', name: '充电', icon: '🔌', parentId: 'exp-shopping' });
    await expect(createCategory({ type: 'expense', name: 'x', icon: '🔌', parentId: 'exp-traffic-charge' })).rejects.toThrow('两级');

    await moveCategory(id, 'up');
    const after = childrenOf('exp-traffic', await listCategories('expense'));
    expect(after[after.length - 2].id).toBe(id);
    expect((await tops())[1].id).toBe('exp-traffic'); // 一级分类顺序不受影响
  });

  it('预置补齐：已有库只补缺失项，不覆盖改名（D07）', async () => {
    await updateCategory('exp-food', { name: '吃饭' });
    await db.categories.delete('exp-insurance');
    await db.categories.delete('exp-insurance-accident');
    await ensureSeed();
    const map = new Map((await listCategories()).map((c) => [c.id, c]));
    expect(map.get('exp-food')?.name).toBe('吃饭');
    expect(map.get('exp-insurance')?.name).toBe('保险');
    expect(fullName('exp-insurance-accident', map)).toBe('保险 › 意外险');
    expect(rootOf('exp-traffic-charge', map)?.id).toBe('exp-traffic');
    expect([...descendantIds('exp-pet', [...map.values()])]).toEqual(['exp-pet', 'exp-pet-supplies', 'exp-pet-vet']);
  });
});

describe('备份', () => {
  it('导出 → 清空流水 → 覆盖导入完全恢复（F13 / Y08 / Y09）', async () => {
    const keepId = await addTx({ type: 'expense', amount: 2800, categoryId: 'exp-food', occurredAt: oct(27) });
    await createCategory({ type: 'expense', name: '咖啡', icon: '☕' });
    const text = JSON.stringify(await buildBackup());
    expect(text).not.toContain('"dirty"');

    expect(await clearAllTransactions()).toBe(1);
    expect(await listByMonth('2026-10')).toHaveLength(0);
    expect((await listCategories('expense')).some((c) => c.name === '咖啡')).toBe(true);
    const extraId = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(26) });

    const before = Date.now();
    const r = await importBackup(parseBackup(text), 'overwrite');
    expect(r.added).toBe(1);
    const txs = await listByMonth('2026-10');
    expect(txs.map((t) => t.id)).toEqual([keepId]);
    // 覆盖导入的记录要比云端新，且待同步
    expect(txs[0].updatedAt).toBeGreaterThanOrEqual(before);
    expect(txs[0].dirty).toBe(1);
    expect((await db.transactions.get(extraId))?.deleted).toBe(true);
  });

  it('合并不产生重复，较新的记录覆盖（F14）', async () => {
    const id = await addTx({ type: 'expense', amount: 2800, categoryId: 'exp-food', occurredAt: oct(27) });
    const backup = await buildBackup();
    backup.data.transactions[0] = { ...backup.data.transactions[0], amount: 5000, updatedAt: Date.now() + 1000 };
    backup.data.transactions.push({
      id: 'other', type: 'income', amount: 100, categoryId: 'inc-other', accountId: DEFAULT_ACCOUNT_ID,
      occurredAt: oct(2), createdAt: 1, updatedAt: 1,
    });

    const r = await importBackup(parseBackup(JSON.stringify(backup)), 'merge');
    expect(r).toEqual({ added: 1, updated: 1, skipped: 0 });
    expect(await listByMonth('2026-10')).toHaveLength(2);
    expect((await getTx(id))?.amount).toBe(5000);
    expect(await listCategories()).toHaveLength(presetCategories().length);

    const again = await importBackup(parseBackup(JSON.stringify(backup)), 'merge');
    expect(again).toEqual({ added: 0, updated: 0, skipped: 2 });
  });

  it('非法文件（F15）', () => {
    expect(() => parseBackup('not json')).toThrow(INVALID_BACKUP);
    expect(() => parseBackup('{"app":"x"}')).toThrow(INVALID_BACKUP);
    expect(() => parseBackup(JSON.stringify({ app: 'my-ledger', schemaVersion: 1, data: { transactions: [{ id: 1 }], categories: [] } }))).toThrow(INVALID_BACKUP);
  });

  it('CSV 带 BOM、金额为元、转义逗号（F16）', async () => {
    await addTx({ type: 'expense', amount: 123456, categoryId: 'exp-food', occurredAt: oct(27), note: '聚餐,AA' });
    const blob = await exportCsvBlob();
    // Blob.text() 解码时会吞掉 BOM，所以直接检查字节
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob.text();
    expect(text).toContain('支出,餐饮,默认账户,1234.56,"聚餐,AA"');
  });
});

describe('编辑交易对方 / 商品（S11）', () => {
  it('新增时写入 meta；修改时保留导入的其他字段；清空则移除', async () => {
    const id = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(1), counterparty: ' 楼下面馆 ', goods: '' });
    expect((await getTx(id))?.meta).toEqual({ counterparty: '楼下面馆' });

    await db.transactions.update(id, { meta: { counterparty: '美团', goods: '午餐', status: '支付成功', merchantOrderNo: 'M1' } });
    await updateTx(id, { type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(1), goods: '晚餐' });
    expect((await getTx(id))?.meta).toEqual({ counterparty: '美团', goods: '晚餐', status: '支付成功', merchantOrderNo: 'M1' });

    // 不传则不修改
    await updateTx(id, { type: 'expense', amount: 200, categoryId: 'exp-food', occurredAt: oct(1) });
    expect((await getTx(id))?.meta?.goods).toBe('晚餐');

    await updateTx(id, { type: 'expense', amount: 200, categoryId: 'exp-food', occurredAt: oct(1), counterparty: '', goods: '' });
    expect((await getTx(id))?.meta).toEqual({ status: '支付成功', merchantOrderNo: 'M1' });

    const plain = await addTx({ type: 'expense', amount: 100, categoryId: 'exp-food', occurredAt: oct(1) });
    expect((await getTx(plain))?.meta).toBeUndefined();
  });
});
