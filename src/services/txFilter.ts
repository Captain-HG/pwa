import dayjs, { type Dayjs } from 'dayjs';
import { descendantIds, fullName } from '@/domain/category';
import { fenToInput, yuanToFen } from '@/domain/money';
import type { Category, Transaction } from '@/domain/types';

/** 明细的搜索、筛选与排序（详细设计-搜索筛选排序） */

export type SortKey = 'time_desc' | 'time_asc' | 'amount_desc' | 'amount_asc';
export type SourceKey = 'manual' | 'alipay' | 'wechat';
export type RangeKey = 'month' | 'last_month' | '3m' | 'year' | 'all' | 'custom';

export interface TxFilter {
  range: RangeKey;
  from?: string;
  to?: string;
  /** 指定自然月（统计页下钻），优先于 range */
  month?: string;
  type?: 'expense' | 'income';
  categories: string[];
  minFen?: number;
  maxFen?: number;
  sources: SourceKey[];
  q: string;
  sort: SortKey;
}

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'time_desc', label: '时间从新到旧' },
  { key: 'time_asc', label: '时间从旧到新' },
  { key: 'amount_desc', label: '金额从高到低' },
  { key: 'amount_asc', label: '金额从低到高' },
];

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: '本月' },
  { key: 'last_month', label: '上月' },
  { key: '3m', label: '近 3 个月' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
  { key: 'custom', label: '自定义' },
];

export const SOURCES: { key: SourceKey; label: string }[] = [
  { key: 'manual', label: '手动记账' },
  { key: 'alipay', label: '支付宝' },
  { key: 'wechat', label: '微信' },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function emptyFilter(): TxFilter {
  return { range: 'month', categories: [], sources: [], q: '', sort: 'time_desc' };
}

const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v));
const list = (v: unknown) => str(v).split(',').map((s) => s.trim()).filter(Boolean);
const fen = (v: unknown) => {
  const s = str(v).trim();
  if (!s) return undefined;
  const n = yuanToFen(s);
  return Number.isFinite(n) ? n : undefined;
};

/** 网址参数 → 条件（兼容 v1.4 的 month / day / category） */
export function parseFilter(query: Record<string, unknown>): TxFilter {
  const f = emptyFilter();
  const range = str(query.range) as RangeKey;
  if (RANGES.some((r) => r.key === range)) f.range = range;
  const day = str(query.day);
  if (DATE.test(day)) {
    f.range = 'custom';
    f.from = f.to = day;
  }
  if (DATE.test(str(query.from))) f.from = str(query.from);
  if (DATE.test(str(query.to))) f.to = str(query.to);
  if ((f.from || f.to) && !query.range && !day) f.range = 'custom';
  if (MONTH.test(str(query.month))) f.month = str(query.month);
  const type = str(query.type);
  if (type === 'expense' || type === 'income') f.type = type;
  f.categories = [...new Set([...list(query.cats), ...list(query.category)])];
  f.minFen = fen(query.min);
  f.maxFen = fen(query.max);
  f.sources = list(query.src).filter((s): s is SourceKey => SOURCES.some((x) => x.key === s));
  f.q = str(query.q).trim();
  const sort = str(query.sort) as SortKey;
  if (SORTS.some((s) => s.key === sort)) f.sort = sort;
  return f;
}

const yuan = (v: number) => fenToInput(v);

/** 条件 → 网址参数；缺省值不写入 */
export function toQuery(f: TxFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.month) q.month = f.month;
  else if (f.range !== 'month') q.range = f.range;
  if (!f.month && f.range === 'custom') {
    if (f.from) q.from = f.from;
    if (f.to) q.to = f.to;
  }
  if (f.type) q.type = f.type;
  if (f.categories.length) q.cats = f.categories.join(',');
  if (f.minFen !== undefined) q.min = yuan(f.minFen);
  if (f.maxFen !== undefined) q.max = yuan(f.maxFen);
  if (f.sources.length) q.src = f.sources.join(',');
  if (f.q) q.q = f.q;
  if (f.sort !== 'time_desc') q.sort = f.sort;
  return q;
}

/** 时间范围 [起, 止]（毫秒，含两端）；不限时返回 null */
export function timeRange(f: TxFilter, today: Dayjs = dayjs()): [number, number] | null {
  const span = (a: Dayjs, b: Dayjs): [number, number] => [a.valueOf(), b.valueOf()];
  if (f.month) {
    const m = dayjs(f.month + '-01');
    return span(m.startOf('month'), m.endOf('month'));
  }
  switch (f.range) {
    case 'month':
      return span(today.startOf('month'), today.endOf('month'));
    case 'last_month': {
      const m = today.subtract(1, 'month');
      return span(m.startOf('month'), m.endOf('month'));
    }
    case '3m':
      return span(today.subtract(2, 'month').startOf('month'), today.endOf('month'));
    case 'year':
      return span(today.startOf('year'), today.endOf('year'));
    case 'all':
      return null;
    case 'custom':
      if (!f.from && !f.to) return null;
      return [
        f.from ? dayjs(f.from).startOf('day').valueOf() : 0,
        f.to ? dayjs(f.to).endOf('day').valueOf() : Number.MAX_SAFE_INTEGER,
      ];
  }
}

function searchText(t: Transaction, map: Map<string, Category>): string {
  return [t.note, t.meta?.counterparty, t.meta?.goods, fullName(t.categoryId, map)].filter(Boolean).join(' ').toLowerCase();
}

/** 筛选 + 排序 */
export function applyFilter(txs: Transaction[], f: TxFilter, categories: Category[], today: Dayjs = dayjs()): Transaction[] {
  const map = new Map(categories.map((c) => [c.id, c]));
  const range = timeRange(f, today);
  const cats = f.categories.length ? new Set(f.categories.flatMap((id) => [...descendantIds(id, categories)])) : null;
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = txs.filter(
    (t) =>
      !t.deleted &&
      (!range || (t.occurredAt >= range[0] && t.occurredAt <= range[1])) &&
      (!f.type || t.type === f.type) &&
      (!cats || (!!t.categoryId && cats.has(t.categoryId))) &&
      (f.minFen === undefined || t.amount >= f.minFen) &&
      (f.maxFen === undefined || t.amount <= f.maxFen) &&
      (!f.sources.length || f.sources.includes(t.source ?? 'manual')) &&
      (!words.length || ((s) => words.every((w) => s.includes(w)))(searchText(t, map))),
  );
  const byTime = (a: Transaction, b: Transaction) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt;
  const sorters: Record<SortKey, (a: Transaction, b: Transaction) => number> = {
    time_desc: (a, b) => byTime(b, a),
    time_asc: byTime,
    amount_desc: (a, b) => b.amount - a.amount || byTime(b, a),
    amount_asc: (a, b) => a.amount - b.amount || byTime(b, a),
  };
  return out.sort(sorters[f.sort]);
}

export interface FilterChip {
  key: string;
  label: string;
  /** 移除该条件后的新条件 */
  remove: (f: TxFilter) => TxFilter;
}

/** 已生效条件的标签（时间总会显示，但「本月」不可移除） */
export function describeFilter(f: TxFilter, nameOf: (id: string) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  const reset = (patch: Partial<TxFilter>) => (x: TxFilter) => ({ ...x, ...patch });
  if (f.month) chips.push({ key: 'month', label: dayjs(f.month + '-01').format('YYYY年M月'), remove: reset({ month: undefined, range: 'month' }) });
  else if (f.range === 'custom')
    chips.push({ key: 'range', label: `${f.from ?? '不限'} ~ ${f.to ?? '不限'}`, remove: reset({ range: 'month', from: undefined, to: undefined }) });
  else if (f.range !== 'month') chips.push({ key: 'range', label: RANGES.find((r) => r.key === f.range)!.label, remove: reset({ range: 'month' }) });
  if (f.type) chips.push({ key: 'type', label: f.type === 'expense' ? '支出' : '收入', remove: reset({ type: undefined }) });
  for (const id of f.categories)
    chips.push({ key: `cat:${id}`, label: nameOf(id), remove: (x) => ({ ...x, categories: x.categories.filter((c) => c !== id) }) });
  if (f.minFen !== undefined || f.maxFen !== undefined)
    chips.push({
      key: 'amount',
      label: `¥${f.minFen !== undefined ? yuan(f.minFen) : '0'}–${f.maxFen !== undefined ? yuan(f.maxFen) : '不限'}`,
      remove: reset({ minFen: undefined, maxFen: undefined }),
    });
  for (const s of f.sources)
    chips.push({ key: `src:${s}`, label: SOURCES.find((x) => x.key === s)!.label, remove: (x) => ({ ...x, sources: x.sources.filter((y) => y !== s) }) });
  if (f.q) chips.push({ key: 'q', label: `“${f.q}”`, remove: reset({ q: '' }) });
  return chips;
}
