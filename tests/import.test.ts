import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetCategories } from '@/db/seed';
import type { Transaction } from '@/domain/types';
import { classify, ruleId } from '@/import/classify';
import { excelSerialToTime, parseAmountFen, parseBeijingTime, parseBill } from '@/import/parse';
import { planImport, summarize, txId, type PlanContext } from '@/import/plan';
import { decodeText, parseCsv, readTable } from '@/import/read';
import { ImportError, type BillRow } from '@/import/types';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, 'fixtures', name)));
const categories = new Map(presetCategories().map((c) => [c.id, c]));
const NOW = Date.UTC(2026, 9, 27, 12);

function ctx(partial: Partial<PlanContext> = {}): PlanContext {
  return { existing: new Map(), manual: [], rules: [], categories, now: NOW, ...partial };
}

const bj = (s: string) => parseBeijingTime(s);

describe('读取', () => {
  it('CSV：引号、字段内逗号、"" 转义、CRLF', () => {
    expect(parseCsv('a,"b,1","c ""x"""\r\nd,e,\n')).toEqual([
      ['a', 'b,1', 'c "x"'],
      ['d', 'e', ''],
    ]);
  });

  it('编码：UTF-8（含 BOM）与 GBK', () => {
    expect(decodeText(new TextEncoder().encode('﻿交易时间'))).toBe('交易时间');
    const gbk = fixture('alipay.csv');
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(gbk)).toThrow();
    expect(decodeText(gbk)).toContain('交易订单号');
  });

  it('金额与时间', () => {
    expect(parseAmountFen('25.25')).toBe(2525);
    expect(parseAmountFen('¥1,016.00')).toBe(101600);
    expect(parseAmountFen('12.340000000000002')).toBe(1234);
    expect(parseAmountFen('0.1')).toBe(10);
    expect(parseAmountFen('abc')).toBeNaN();
    expect(new Date(bj('2026-10-27 11:32:28')).toISOString()).toBe('2026-10-27T03:32:28.000Z');
    // 真实样本中的序列数：46322.387291666666 = 2026-10-27 09:17:42（北京时间）
    expect(excelSerialToTime(46322.387291666666)).toBe(bj('2026-10-27 09:17:42'));
  });

  it('无关文件报错', () => {
    expect(() => parseBill(parseCsv('a,b\n1,2\n'))).toThrow(ImportError);
    expect(() => parseBill(parseCsv('交易时间,收/支,金额\n2026-10-01 10:00:00,支出,1\n'))).toThrow('只支持支付宝和微信');
    expect(() => parseBill(parseCsv('交易时间,收/支,交易订单号,交易状态\n2026-10-01 10:00:00,支出,1,成功\n'))).toThrow('缺少「金额」列');
    expect(() => readTable(new Uint8Array([0x50, 0x4b, 1, 2]))).toThrow('Excel');
  });
});

describe('支付宝（I01）', () => {
  const bill = parseBill(readTable(fixture('alipay.csv')));
  const byOrder = (suffix: string) => bill.rows.find((r) => r.orderNo.endsWith(suffix))!;

  it('识别来源与字段', () => {
    expect(bill.source).toBe('alipay');
    expect(bill.rows).toHaveLength(11);
    const first = byOrder('0001');
    expect(first).toMatchObject({
      orderNo: '2026102710255301046700000001', // 去掉了 \t
      direction: 'expense',
      amountFen: 2525,
      counterparty: '美团外卖',
      billCategory: '餐饮美食',
      time: bj('2026-10-27 11:32:28'),
    });
    expect(byOrder('0002').goods).toBe('纸巾,10包装');
    expect(byOrder('0010').amountFen).toBe(101600);
  });

  it('跳过规则（I05）', () => {
    expect(byOrder('0003').skip).toBe('金额为 0');
    expect(byOrder('0004').skip).toBe('不计收支');
    expect(byOrder('0006').skip).toBe('交易关闭');
    expect(byOrder('0002').skip).toBeUndefined(); // 等待确认收货照常导入
    expect(byOrder('0007')).toMatchObject({ refund: 'unmatched', direction: 'income', skip: undefined });
  });

  it('分类：支付宝自带分类、收入、退款', () => {
    const cat = (s: string) => classify(byOrder(s), [], categories);
    expect(cat('0001')).toBe('exp-food-takeout'); // 餐饮美食 + 「美团外卖」细化
    expect(cat('0002')).toBe('exp-shopping-daily'); // 日用百货
    expect(cat('0008')).toBe('exp-traffic-taxi'); // 交通出行 + 「滴滴」
    expect(cat('0009')).toBe('exp-insurance-accident'); // 保险 + 「意外险」
    expect(cat('0010')).toBe('exp-pet-supplies'); // 宠物 + 「猫粮」
    expect(cat('0005')).toBe('inc-redpacket'); // 转账红包收入
    expect(cat('0007')).toBe('inc-refund'); // 退款
  });

  it('导入计划', () => {
    const plan = planImport(bill.rows, ctx());
    const s = summarize(plan);
    expect(s.counts).toEqual({ new: 7, update: 0, suspect: 0, exists: 0, deleted: 0, skip: 4 });
    expect(s.newTotal).toEqual({ expense: 2525 + 1166 + 1880 + 410 + 101600, income: 10000 + 990 });
    const refund = plan.find((p) => p.id === 'alipay-2026102110255301046700000007')!;
    expect(refund.tx.note).toBe('退款 · 某某旗舰店 · 退款-数据线');
  });
});

describe('微信（I02 / I06）', () => {
  const bill = parseBill(readTable(fixture('wechat.xlsx')));
  const byOrder = (suffix: string) => bill.rows.find((r) => r.orderNo.endsWith(suffix))!;

  it('识别来源、序列数时间、数字金额', () => {
    expect(bill.source).toBe('wechat');
    expect(bill.rows).toHaveLength(13);
    expect(byOrder('0001')).toMatchObject({ time: bj('2026-10-27 09:17:42'), amountFen: 2300, counterparty: '美团' });
    expect(byOrder('0012').amountFen).toBe(1234);
    expect(byOrder('0009').amountFen).toBe(666);
  });

  it('部分退款：原交易按净额，退款行配对后跳过（I06）', () => {
    expect(byOrder('0002')).toMatchObject({ amountFen: 5000, refundedFen: 3001, netFen: 1999, skip: undefined });
    expect(byOrder('0003')).toMatchObject({ refund: 'matched', skip: '退款已从原交易中扣除' });
  });

  it('全额退款：两行都跳过（I06b）', () => {
    expect(byOrder('0004')).toMatchObject({ netFen: 0, skip: '已全额退款' });
    expect(byOrder('0005')).toMatchObject({ refund: 'matched', skip: '退款已从原交易中扣除' });
  });

  it('找不到原交易的退款：记为收入（I06c）', () => {
    expect(byOrder('0006')).toMatchObject({ refund: 'unmatched', direction: 'income', skip: undefined });
  });

  it('中性交易与 0 元跳过', () => {
    expect(byOrder('0011').skip).toBe('中性交易');
    expect(byOrder('0013').skip).toBe('金额为 0');
  });

  it('分类：关键词、转账、红包', () => {
    const cat = (s: string) => classify(byOrder(s), [], categories);
    expect(cat('0001')).toBe('exp-food'); // 「美团」无法细分
    expect(cat('0002')).toBe('exp-traffic-charge'); // 新电途
    expect(cat('0007')).toBe('exp-gift-transfer');
    expect(cat('0008')).toBe('inc-redpacket');
    expect(cat('0009')).toBe('inc-redpacket');
    expect(cat('0010')).toBe('exp-shopping-daily'); // 商行
    expect(cat('0012')).toBe('exp-food-drink'); // 瑞幸
    expect(cat('0006')).toBe('inc-refund');
  });

  it('导入计划与备注', () => {
    const plan = planImport(bill.rows, ctx());
    const s = summarize(plan);
    expect(s.counts).toEqual({ new: 8, update: 0, suspect: 0, exists: 0, deleted: 0, skip: 5 });
    expect(s.newTotal).toEqual({ expense: 2300 + 1999 + 10000 + 1050 + 1234, income: 20000 + 8800 + 666 });
    const charge = plan.find((p) => p.row.orderNo.endsWith('0002'))!;
    expect(charge.tx).toMatchObject({ amount: 1999, importedAmount: 1999, source: 'wechat' });
    expect(charge.tx.note).toBe('新电途 · 充电预付款（已退款 ¥30.01）');
    expect(plan.find((p) => p.row.orderNo.endsWith('0006'))!.tx.note).toBe('退款');
  });
});

describe('去重', () => {
  const bill = parseBill(readTable(fixture('wechat.xlsx')));
  const newRows = () => planImport(bill.rows, ctx()).filter((p) => p.kind === 'new');

  it('同一文件导入两次：第二次全部为已导入（I03 / I10）', () => {
    const existing = new Map(newRows().map((p) => [p.id, p.tx]));
    const again = summarize(planImport(bill.rows, ctx({ existing })));
    expect(again.counts).toMatchObject({ new: 0, exists: 8, skip: 5 });
  });

  it('删除过的导入记录单独列出，默认不恢复（I12）', () => {
    const [first] = newRows();
    const existing = new Map([[first.id, { ...first.tx, deleted: true }]]);
    const plan = planImport(bill.rows, ctx({ existing }));
    expect(plan.find((p) => p.id === first.id)).toMatchObject({ kind: 'deleted', reason: '之前删除过' });
    expect(summarize(plan).counts).toMatchObject({ new: 7, deleted: 1 });
  });

  it('后来发生退款：未改过金额的记录更新为净额，全额退款则删除（I06c）', () => {
    const partial = bill.rows.find((r) => r.orderNo.endsWith('0002'))!;
    const full = bill.rows.find((r) => r.orderNo.endsWith('0004'))!;
    const old = (r: BillRow): Transaction => ({
      id: txId(r), type: 'expense', amount: 5000, importedAmount: 5000, accountId: 'default',
      occurredAt: r.time, createdAt: 1, updatedAt: 1, source: 'wechat',
    });
    const existing = new Map([[txId(partial), old(partial)], [txId(full), old(full)]]);
    const plan = planImport(bill.rows, ctx({ existing }));
    expect(plan.find((p) => p.id === txId(partial))).toMatchObject({ kind: 'update', reason: '金额 50.00 → 19.99' });
    expect(plan.find((p) => p.id === txId(full))).toMatchObject({ kind: 'update', reason: '已全额退款，将删除' });

    // 用户手动改过金额的不覆盖
    existing.set(txId(partial), { ...old(partial), amount: 4500 });
    expect(planImport(bill.rows, ctx({ existing })).find((p) => p.id === txId(partial))).toMatchObject({
      kind: 'exists',
      reason: '已导入（金额已手动修改）',
    });
  });

  it('疑似与手动记录重复：金额相同、30 分钟内，每条手动记录只匹配一次（I06d）', () => {
    const meituan = bill.rows.find((r) => r.orderNo.endsWith('0001'))!;
    const manual: Transaction = {
      id: 'm1', type: 'expense', amount: 2300, accountId: 'default', occurredAt: meituan.time + 20 * 60_000,
      createdAt: 1, updatedAt: 1, categoryId: 'exp-food',
    };
    const far = { ...manual, id: 'm2', amount: 1050, occurredAt: meituan.time + 3 * 86_400_000 };
    const plan = planImport(bill.rows, ctx({ manual: [manual, far] }));
    expect(plan.find((p) => p.id === txId(meituan))).toMatchObject({ kind: 'suspect', manual: { id: 'm1' } });
    expect(summarize(plan).counts).toMatchObject({ new: 7, suspect: 1 });
  });
});

describe('用户规则（I08）', () => {
  const bill = parseBill(readTable(fixture('wechat.xlsx')));
  const shop = bill.rows.find((r) => r.orderNo.endsWith('0010'))!;

  it('用户规则优先，关键词越长越优先，类型不符的忽略', () => {
    const rules = [
      { id: ruleId('商行'), keyword: '商行', categoryId: 'exp-fun' },
      { id: ruleId('某某商行'), keyword: '某某商行', categoryId: 'exp-housing' },
      { id: ruleId('某某'), keyword: '某某', categoryId: 'inc-salary' },
    ];
    expect(classify(shop, rules, categories)).toBe('exp-housing');
  });

  it('规则 id 稳定、不区分大小写', () => {
    expect(ruleId('ABC')).toBe(ruleId('abc'));
    expect(ruleId('美团')).not.toBe(ruleId('滴滴'));
  });
});

describe('写入本地库（applyImport）', async () => {
  const { beforeEach } = await import('vitest');
  const { db } = await import('@/db/schema');
  const { ensureSeed } = await import('@/db/seed');
  const { wipeLocal } = await import('@/services/backup');
  const { applyImport, groupKey, prepareImport } = await import('@/services/billImport');
  const { countPending } = await import('@/sync/sync');
  const blob = (name: string) => new Blob([fixture(name)]);

  beforeEach(async () => {
    await wipeLocal();
    await ensureSeed();
  });

  async function importAll(name: string, overrides = new Map<string, string>()) {
    const p = await prepareImport(blob(name));
    const include = new Set(p.items.filter((i) => i.kind === 'new').map((i) => i.id));
    return { p, r: await applyImport(p.items, { include, overrides }) };
  }

  it('写入、标记待同步；再次导入全部判为已导入（I03）', async () => {
    const { r } = await importAll('wechat.xlsx');
    expect(r).toMatchObject({ added: 8, updated: 0, removed: 0 });
    expect(await countPending()).toBe(8);
    const tx = await db.transactions.get('wechat-4200000001202610260000000002');
    expect(tx).toMatchObject({ amount: 1999, importedAmount: 1999, source: 'wechat', dirty: 1 });

    const again = await prepareImport(blob('wechat.xlsx'));
    expect(again.items.filter((i) => i.kind === 'new')).toHaveLength(0);
    expect(again.items.filter((i) => i.kind === 'exists')).toHaveLength(8);
  });

  it('调整分类保存为规则，下次导入自动命中，规则参与同步（I08）', async () => {
    const shopKey = '某某商行';
    const { r } = await importAll('wechat.xlsx', new Map([[shopKey, 'exp-fun']]));
    expect(r.rules).toBe(1);
    expect((await db.transactions.get('wechat-10001071012026102000000000010'))?.categoryId).toBe('exp-fun');
    const rule = (await db.rules.toArray())[0];
    expect(rule).toMatchObject({ keyword: shopKey, categoryId: 'exp-fun', dirty: 1 });

    await db.transactions.clear();
    const p = await prepareImport(blob('wechat.xlsx'));
    const shop = p.items.find((i) => groupKey(i) === shopKey)!;
    expect(shop.tx.categoryId).toBe('exp-fun');
  });

  it('退款后重新导入：更新金额或删除（I06c）', async () => {
    // 模拟上个月导入时还没有退款
    await db.transactions.bulkPut([
      { id: 'wechat-4200000001202610260000000002', type: 'expense', amount: 5000, importedAmount: 5000, accountId: 'default', categoryId: 'exp-traffic', occurredAt: 1, createdAt: 1, updatedAt: 1, source: 'wechat' },
      { id: 'wechat-4200000001202610250000000004', type: 'expense', amount: 5000, importedAmount: 5000, accountId: 'default', categoryId: 'exp-traffic', occurredAt: 1, createdAt: 1, updatedAt: 1, source: 'wechat' },
    ]);
    const { r } = await importAll('wechat.xlsx');
    expect(r).toMatchObject({ updated: 1, removed: 1 });
    expect((await db.transactions.get('wechat-4200000001202610260000000002'))?.amount).toBe(1999);
    expect((await db.transactions.get('wechat-4200000001202610250000000004'))?.deleted).toBe(true);
  });

  it('疑似重复默认不写入', async () => {
    await db.transactions.add({
      id: 'manual-1', type: 'expense', amount: 2300, accountId: 'default', categoryId: 'exp-food',
      occurredAt: bj('2026-10-27 09:30:00'), createdAt: 1, updatedAt: 1,
    });
    const { p, r } = await importAll('wechat.xlsx');
    expect(p.items.filter((i) => i.kind === 'suspect')).toHaveLength(1);
    expect(r.added).toBe(7);
  });
});

describe('界面传入响应式对象', async () => {
  const { reactive } = await import('vue');
  const { db } = await import('@/db/schema');
  const { applyImport, prepareImport } = await import('@/services/billImport');

  it('applyImport 接受 Vue 响应式代理（回归：DataCloneError）', async () => {
    await db.transactions.clear();
    const p = await prepareImport(new Blob([fixture('alipay.csv')]));
    const items = reactive(p.items) as typeof p.items;
    const include = new Set(p.items.filter((i) => i.kind === 'new').map((i) => i.id));
    const r = await applyImport(items, { include, overrides: new Map() });
    expect(r.added).toBe(7);
  });
});

describe('关键词与支付宝分类（v1.4）', () => {
  const row = (p: Partial<BillRow>): BillRow => ({
    source: 'alipay', orderNo: '1', time: 0, direction: 'expense', amountFen: 100, netFen: 100,
    counterparty: '', goods: '', txType: '', billCategory: '', status: '', method: '', merchantOrderNo: '', refundedFen: 0, ...p,
  });
  const cat = (p: Partial<BillRow>) => classify(row(p), [], categories);

  it('最长关键词优先', () => {
    expect(cat({ counterparty: '猫眼电影' })).toBe('exp-fun-movie');
    expect(cat({ counterparty: '某某宠物店', goods: '猫粮' })).toBe('exp-pet-supplies');
    expect(cat({ counterparty: '国家电网' })).toBe('exp-housing-utility');
  });

  it('支付宝分类为一级时，只在同一一级分类下细化；冲突时以支付宝分类为准', () => {
    expect(cat({ billCategory: '保险', goods: '车险续保' })).toBe('exp-insurance-car');
    expect(cat({ billCategory: '保险', goods: '买了个充电宝' })).toBe('exp-insurance');
    expect(cat({ billCategory: '日用百货', goods: '耳机' })).toBe('exp-shopping-daily');
  });
});

describe('补全已导入记录（D10）', () => {
  const bill = parseBill(readTable(fixture('alipay.csv')));
  const ins = bill.rows.find((r) => r.orderNo.endsWith('0009'))!; // 保险 · 意外险
  const base = (p: Partial<Transaction>): Transaction => ({
    id: txId(ins), type: 'expense', amount: 410, importedAmount: 410, accountId: 'default',
    occurredAt: ins.time, createdAt: 1, updatedAt: 1, source: 'alipay', ...p,
  });
  const plan = (existing: Transaction) => planImport(bill.rows, ctx({ existing: new Map([[existing.id, existing]]) })).find((p) => p.id === existing.id)!;

  it('v1.3 导入的（无 meta）：补全详情，并从「其他」细化', () => {
    const it = plan(base({ categoryId: 'exp-other' }));
    expect(it.kind).toBe('exists');
    expect(it.enrich?.categoryId).toBe('exp-insurance-accident');
    expect(it.enrich?.meta).toMatchObject({ counterparty: '某某保险公司', goods: '意外险保费', billType: '保险', autoCategoryId: 'exp-insurance-accident' });
  });

  it('一级分类细化为其子分类；用户改成别的分类则不动，只补详情', () => {
    expect(plan(base({ categoryId: 'exp-insurance' })).enrich?.categoryId).toBe('exp-insurance-accident');
    const manual = plan(base({ categoryId: 'exp-medical-clinic' }));
    expect(manual.enrich?.categoryId).toBeUndefined();
    expect(manual.enrich?.meta).toBeDefined();
  });

  it('有 meta 时以导入时的自动分类判断是否改过；已完整的不再补全', () => {
    const meta = { counterparty: 'x', autoCategoryId: 'exp-other' };
    expect(plan(base({ categoryId: 'exp-other', meta })).enrich?.categoryId).toBe('exp-insurance-accident');
    expect(plan(base({ categoryId: 'exp-fun', meta })).enrich).toBeUndefined();
    const done = plan(base({ categoryId: 'exp-insurance-accident', meta: { autoCategoryId: 'exp-insurance-accident' } }));
    expect(done.enrich).toBeUndefined();
  });

  it('新导入的记录带完整 meta', () => {
    const it = planImport(bill.rows, ctx()).find((p) => p.id === txId(ins))!;
    expect(it.tx.meta).toMatchObject({ method: '示例银行储蓄卡(0001)', status: '支付成功', merchantOrderNo: 'M0009', autoCategoryId: 'exp-insurance-accident' });
  });
});

describe('重新导入补全（数据库，D10）', async () => {
  const { beforeEach } = await import('vitest');
  const { db } = await import('@/db/schema');
  const { ensureSeed } = await import('@/db/seed');
  const { wipeLocal } = await import('@/services/backup');
  const { applyImport, prepareImport } = await import('@/services/billImport');

  beforeEach(async () => {
    await wipeLocal();
    await ensureSeed();
  });

  it('v1.3 导入的记录：补全 meta、细化分类，不新增', async () => {
    const first = await prepareImport(new Blob([fixture('alipay.csv')]));
    const include = new Set(first.items.filter((i) => i.kind === 'new').map((i) => i.id));
    await applyImport(first.items, { include, overrides: new Map() });
    // 模拟 v1.3：没有 meta，保险被分到「其他」，滴滴被分到「交通」
    await db.transactions.toCollection().modify((t) => {
      delete t.meta;
      if (t.id.endsWith('0009')) t.categoryId = 'exp-other';
      if (t.id.endsWith('0008')) t.categoryId = 'exp-traffic';
      if (t.id.endsWith('0010')) t.categoryId = 'exp-fun'; // 用户手动改过
    });

    const again = await prepareImport(new Blob([fixture('alipay.csv')]));
    expect(again.items.filter((i) => i.kind === 'new')).toHaveLength(0);
    const r = await applyImport(again.items, { include: new Set(), overrides: new Map() });
    expect(r).toMatchObject({ added: 0, enriched: 7 });

    const get = (s: string) => db.transactions.get(`alipay-202610${s}`);
    expect((await get('1910255301046700000009'))?.categoryId).toBe('exp-insurance-accident');
    expect((await get('2010255301046700000008'))?.categoryId).toBe('exp-traffic-taxi');
    expect((await get('1810255301046700000010'))?.categoryId).toBe('exp-fun');
    expect((await get('1810255301046700000010'))?.meta?.counterparty).toBe('某某宠物店');

    const third = await prepareImport(new Blob([fixture('alipay.csv')]));
    expect(third.items.filter((i) => i.enrich)).toHaveLength(0);
  });
});

describe('恢复删除过的导入记录（数据库，I12）', async () => {
  const { beforeEach } = await import('vitest');
  const { db } = await import('@/db/schema');
  const { ensureSeed } = await import('@/db/seed');
  const { clearAllTransactions, wipeLocal } = await import('@/services/backup');
  const { applyImport, prepareImport } = await import('@/services/billImport');

  beforeEach(async () => {
    await wipeLocal();
    await ensureSeed();
  });

  it('清空后重新导入：默认不写入；勾选后恢复为未删除、待同步，并带完整详情', async () => {
    const first = await prepareImport(new Blob([fixture('wechat.xlsx')]));
    await applyImport(first.items, { include: new Set(first.items.filter((i) => i.kind === 'new').map((i) => i.id)), overrides: new Map() });
    expect(await clearAllTransactions()).toBe(8);

    const again = await prepareImport(new Blob([fixture('wechat.xlsx')]));
    const deleted = again.items.filter((i) => i.kind === 'deleted');
    expect(deleted).toHaveLength(8);
    expect(again.items.filter((i) => i.kind === 'new')).toHaveLength(0);

    // 默认（不勾选）什么也不写
    const none = await applyImport(again.items, { include: new Set(), overrides: new Map() });
    expect(none).toMatchObject({ added: 0, restored: 0 });
    expect(await db.transactions.filter((t) => !t.deleted).count()).toBe(0);

    const before = Date.now();
    const r = await applyImport(again.items, { include: new Set(deleted.map((i) => i.id)), overrides: new Map() });
    expect(r).toMatchObject({ added: 0, restored: 8 });
    const restored = await db.transactions.get('wechat-4200000001202610260000000002');
    expect(restored).toMatchObject({ amount: 1999, dirty: 1, meta: { counterparty: '新电途' } });
    expect(restored?.deleted).toBeUndefined();
    expect(restored!.updatedAt).toBeGreaterThanOrEqual(before);

    // 恢复后再导入：全部为已导入
    const third = await prepareImport(new Blob([fixture('wechat.xlsx')]));
    expect(third.items.filter((i) => i.kind === 'exists')).toHaveLength(8);
  });
});
