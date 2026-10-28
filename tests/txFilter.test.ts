import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { presetCategories } from '@/db/seed';
import type { Transaction } from '@/domain/types';
import { applyFilter, describeFilter, emptyFilter, parseFilter, timeRange, toQuery, type TxFilter } from '@/services/txFilter';

const cats = presetCategories();
const today = dayjs('2026-10-28 10:00');
let seq = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`, type: 'expense', amount: 1000, accountId: 'default', categoryId: 'exp-other',
  occurredAt: dayjs('2026-10-15 12:00').valueOf(), createdAt: seq, updatedAt: seq, ...p,
});
const at = (s: string) => dayjs(s).valueOf();
const ids = (list: Transaction[]) => list.map((t) => t.id);
const f = (p: Partial<TxFilter>): TxFilter => ({ ...emptyFilter(), ...p });

describe('网址参数', () => {
  it('解析与序列化互逆，缺省值不写入', () => {
    const q = { range: 'custom', from: '2026-09-01', to: '2026-10-15', type: 'expense', cats: 'exp-food,exp-traffic', min: '10', max: '100.5', src: 'alipay,wechat', q: '美团', sort: 'amount_desc' };
    const parsed = parseFilter(q);
    expect(parsed).toMatchObject({ range: 'custom', minFen: 1000, maxFen: 10050, sources: ['alipay', 'wechat'], sort: 'amount_desc' });
    expect(toQuery(parsed)).toEqual(q);
    expect(toQuery(emptyFilter())).toEqual({});
  });

  it('兼容 v1.4：month / day / category；非法值忽略', () => {
    expect(parseFilter({ month: '2026-10', type: 'expense', category: 'exp-traffic' })).toMatchObject({ month: '2026-10', categories: ['exp-traffic'] });
    expect(parseFilter({ day: '2026-10-27' })).toMatchObject({ range: 'custom', from: '2026-10-27', to: '2026-10-27' });
    expect(parseFilter({ range: 'xx', sort: 'yy', src: 'bank', min: 'abc', type: 'z' })).toEqual(emptyFilter());
  });
});

describe('时间范围（S03）', () => {
  const r = (p: Partial<TxFilter>) => timeRange(f(p), today)?.map((v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'));
  it('预设与自定义', () => {
    expect(r({})).toEqual(['2026-10-01 00:00:00', '2026-10-31 23:59:59']);
    expect(r({ range: 'last_month' })).toEqual(['2026-09-01 00:00:00', '2026-09-30 23:59:59']);
    expect(r({ range: '3m' })).toEqual(['2026-08-01 00:00:00', '2026-10-31 23:59:59']);
    expect(r({ range: 'year' })).toEqual(['2026-01-01 00:00:00', '2026-12-31 23:59:59']);
    expect(r({ range: 'all' })).toBeUndefined();
    expect(r({ range: 'custom', from: '2026-10-27', to: '2026-10-27' })).toEqual(['2026-10-27 00:00:00', '2026-10-27 23:59:59']);
    expect(r({ month: '2026-02' })).toEqual(['2026-02-01 00:00:00', '2026-02-28 23:59:59']);
  });
});

describe('筛选与排序', () => {
  const data = [
    tx({ id: 'a', amount: 2300, categoryId: 'exp-food-takeout', note: '美团外卖 · 午餐', source: 'wechat', meta: { counterparty: '美团' } }),
    tx({ id: 'b', amount: 500, categoryId: 'exp-traffic-charge', source: 'wechat', meta: { counterparty: '新电途' }, occurredAt: at('2026-10-20 08:00') }),
    tx({ id: 'c', amount: 10000, categoryId: 'exp-food', note: '聚餐', occurredAt: at('2026-10-01 00:00') }),
    tx({ id: 'd', amount: 800000, type: 'income', categoryId: 'inc-salary', occurredAt: at('2026-10-10 09:00') }),
    tx({ id: 'e', amount: 4100, categoryId: 'exp-insurance-accident', source: 'alipay', meta: { goods: '意外险保费' }, occurredAt: at('2026-09-30 23:59') }),
    tx({ id: 'f', amount: 999, deleted: true }),
  ];
  const run = (p: Partial<TxFilter>) => ids(applyFilter(data, f(p), cats, today));

  it('默认：本月、未删除、时间倒序（S01）', () => {
    expect(run({})).toEqual(['b', 'a', 'd', 'c']);
  });

  it('关键词：备注 / 交易对方 / 商品 / 分类名，多词需全部命中（S02）', () => {
    expect(run({ q: '美团' })).toEqual(['a']);
    expect(run({ q: '充电', range: 'all' })).toEqual(['b']); // 分类名
    expect(run({ q: '意外', range: 'all' })).toEqual(['e']); // 商品
    expect(run({ q: '美团 午餐' })).toEqual(['a']);
    expect(run({ q: '美团 晚餐' })).toEqual([]);
  });

  it('分类多选包含子分类（S04）', () => {
    expect(run({ categories: ['exp-food'] })).toEqual(['a', 'c']);
    expect(run({ categories: ['exp-food', 'exp-traffic'] })).toEqual(['b', 'a', 'c']);
    expect(run({ categories: ['exp-food-takeout'] })).toEqual(['a']);
  });

  it('金额范围含两端（S05）', () => {
    expect(run({ minFen: 500, maxFen: 2300 })).toEqual(['b', 'a']);
    expect(run({ minFen: 10000 })).toEqual(['d', 'c']);
  });

  it('来源与收支类型（S06）', () => {
    expect(run({ sources: ['wechat'] })).toEqual(['b', 'a']);
    expect(run({ sources: ['manual'] })).toEqual(['d', 'c']);
    expect(run({ type: 'income' })).toEqual(['d']);
    expect(run({ range: 'all', sources: ['alipay'] })).toEqual(['e']);
  });

  it('排序（S07）', () => {
    expect(run({ sort: 'time_asc' })).toEqual(['c', 'd', 'a', 'b']);
    expect(run({ sort: 'amount_desc' })).toEqual(['d', 'c', 'a', 'b']);
    expect(run({ sort: 'amount_asc' })).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('条件标签（S08）', () => {
  it('生成并可逐个移除', () => {
    const filter = f({ range: '3m', type: 'expense', categories: ['exp-food', 'exp-traffic'], minFen: 1000, sources: ['wechat'], q: '美团' });
    const chips = describeFilter(filter, (id) => (id === 'exp-food' ? '餐饮' : '交通'));
    expect(chips.map((c) => c.label)).toEqual(['近 3 个月', '支出', '餐饮', '交通', '¥10–不限', '微信', '“美团”']);
    const without = chips.find((c) => c.key === 'cat:exp-food')!.remove(filter);
    expect(without.categories).toEqual(['exp-traffic']);
    expect(chips[0].remove(filter).range).toBe('month');
    expect(describeFilter(emptyFilter(), () => '')).toEqual([]);
  });
});
