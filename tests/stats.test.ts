import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/domain/types';
import { byCategory, daily, groupByDay, summarize } from '@/services/stats';
import { needsBackupReminder } from '@/services/settings';

let seq = 0;
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'occurredAt'>): Transaction {
  seq++;
  return { id: 't' + seq, accountId: 'default', categoryId: 'c1', createdAt: seq, updatedAt: seq, ...p };
}

const at = (s: string) => dayjs(s).valueOf();

describe('stats', () => {
  const txs = [
    tx({ type: 'expense', amount: 2800, occurredAt: at('2026-10-27 12:00'), categoryId: 'food' }),
    tx({ type: 'expense', amount: 1200, occurredAt: at('2026-10-27 08:00'), categoryId: 'traffic' }),
    tx({ type: 'expense', amount: 6000, occurredAt: at('2026-10-01 19:00'), categoryId: 'food' }),
    tx({ type: 'income', amount: 800000, occurredAt: at('2026-10-10 09:00'), categoryId: 'salary' }),
    tx({ type: 'transfer', amount: 99999, occurredAt: at('2026-10-11 09:00'), categoryId: undefined }),
  ];

  it('summarize 排除转账', () => {
    expect(summarize(txs)).toEqual({ expense: 10000, income: 800000, balance: 790000 });
  });

  it('byCategory 按金额降序，占比合计为 1（F10）', () => {
    const r = byCategory(txs, 'expense');
    expect(r.map((x) => x.categoryId)).toEqual(['food', 'traffic']);
    expect(r[0].amount).toBe(8800);
    expect(r.reduce((s, x) => s + x.ratio, 0)).toBeCloseTo(1);
  });

  it('daily', () => {
    const d = daily(txs, '2026-10', 'expense');
    expect(d).toHaveLength(31);
    expect(d[0]).toBe(6000);
    expect(d[26]).toBe(4000);
  });

  it('groupByDay 倒序并汇总', () => {
    const g = groupByDay(txs, at('2026-10-27 20:00'));
    expect(g.map((x) => x.day)).toEqual(['2026-10-27', '2026-10-11', '2026-10-10', '2026-10-01']);
    expect(g[0].label).toBe('今天 10月27日 周二');
    expect(g[0].expense).toBe(4000);
    expect(g[0].items[0].amount).toBe(2800);
  });
});

describe('backup reminder（F17）', () => {
  const now = at('2026-10-27');
  it('无流水不提醒', () => expect(needsBackupReminder(undefined, 0, now)).toBe(false));
  it('从未备份提醒', () => expect(needsBackupReminder(undefined, 3, now)).toBe(true));
  it('13 天内不提醒', () => expect(needsBackupReminder(now - 13 * 86_400_000, 3, now)).toBe(false));
  it('14 天提醒', () => expect(needsBackupReminder(now - 14 * 86_400_000, 3, now)).toBe(true));
});

describe('按一级分类汇总（D09）', async () => {
  const { presetCategories } = await import('@/db/seed');
  const { rootId } = await import('@/domain/category');
  const map = new Map(presetCategories().map((c) => [c.id, c]));
  const txs = [
    tx({ type: 'expense', amount: 1000, occurredAt: at('2026-10-02 10:00'), categoryId: 'exp-traffic-charge' }),
    tx({ type: 'expense', amount: 500, occurredAt: at('2026-10-02 11:00'), categoryId: 'exp-traffic-taxi' }),
    tx({ type: 'expense', amount: 300, occurredAt: at('2026-10-02 12:00'), categoryId: 'exp-traffic' }),
    tx({ type: 'expense', amount: 200, occurredAt: at('2026-10-02 13:00'), categoryId: 'exp-food-drink' }),
  ];

  it('子分类计入父分类；默认按子分类', () => {
    const top = byCategory(txs, 'expense', (id) => rootId(id, map) ?? id);
    expect(top.map((r) => [r.categoryId, r.amount])).toEqual([['exp-traffic', 1800], ['exp-food', 200]]);
    expect(byCategory(txs, 'expense')).toHaveLength(4);
  });
});
