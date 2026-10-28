import dayjs from 'dayjs';
import type { CategoryType, Transaction } from '@/domain/types';

/** 统计全部是纯函数，入参为某月的流水；转账不计入收支 */

export interface MonthSummary {
  expense: number;
  income: number;
  balance: number;
}

export function summarize(txs: Transaction[]): MonthSummary {
  let expense = 0;
  let income = 0;
  for (const t of txs) {
    if (t.type === 'expense') expense += t.amount;
    else if (t.type === 'income') income += t.amount;
  }
  return { expense, income, balance: income - expense };
}

export interface CategoryStat {
  categoryId: string;
  amount: number;
  ratio: number;
}

/** keyOf 用于汇总口径，例如把子分类归到一级分类：(id) => rootId(id) */
export function byCategory(
  txs: Transaction[],
  type: CategoryType,
  keyOf: (categoryId: string) => string = (id) => id,
): CategoryStat[] {
  const sums = new Map<string, number>();
  let total = 0;
  for (const t of txs) {
    if (t.type !== type || !t.categoryId) continue;
    const key = keyOf(t.categoryId);
    sums.set(key, (sums.get(key) ?? 0) + t.amount);
    total += t.amount;
  }
  return [...sums.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount, ratio: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** 返回长度为当月天数的数组，下标 0 为 1 日 */
export function daily(txs: Transaction[], month: string, type: CategoryType): number[] {
  const result = new Array<number>(dayjs(month + '-01').daysInMonth()).fill(0);
  for (const t of txs) {
    if (t.type === type) result[dayjs(t.occurredAt).date() - 1] += t.amount;
  }
  return result;
}

export interface DayGroup {
  day: string;
  label: string;
  expense: number;
  income: number;
  items: Transaction[];
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function dayLabel(ts: number, now = Date.now()): string {
  const d = dayjs(ts);
  const today = dayjs(now).startOf('day');
  const prefix = d.isSame(today, 'day') ? '今天 ' : d.isSame(today.subtract(1, 'day'), 'day') ? '昨天 ' : '';
  return `${prefix}${d.month() + 1}月${d.date()}日 ${WEEK[d.day()]}`;
}

/** 按日分组，组间、组内都按时间倒序 */
export function groupByDay(txs: Transaction[], now = Date.now()): DayGroup[] {
  const sorted = [...txs].sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt);
  const groups: DayGroup[] = [];
  for (const t of sorted) {
    const day = dayjs(t.occurredAt).format('YYYY-MM-DD');
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, label: dayLabel(t.occurredAt, now), expense: 0, income: 0, items: [] };
      groups.push(g);
    }
    g.items.push(t);
    if (t.type === 'expense') g.expense += t.amount;
    else if (t.type === 'income') g.income += t.amount;
  }
  return groups;
}
