import { DEFAULT_ACCOUNT_ID } from '@/db/seed';
import { formatFen } from '@/domain/money';
import type { Category, Transaction, TxMeta } from '@/domain/types';
import { classify, OTHER_IDS, type Rule } from './classify';
import type { BillRow } from './types';

/** deleted：本地已删除过的导入记录，默认不恢复，用户可勾选恢复 */
export type PlanKind = 'new' | 'update' | 'suspect' | 'exists' | 'deleted' | 'skip';

export interface PlanItem {
  id: string;
  kind: PlanKind;
  row: BillRow;
  /** 将写入的流水（new / suspect / update） */
  tx: Transaction;
  reason?: string;
  /** 已存在的记录（exists / update / skip） */
  existing?: Transaction;
  /** 疑似重复时匹配到的手动记录 */
  manual?: Transaction;
  /** 已存在记录的补全：原始字段、细化后的分类（v1.4） */
  enrich?: { meta?: TxMeta; categoryId?: string };
}

export const SUSPECT_WINDOW = 30 * 60_000;
const NOTE_MAX = 50;

export function txId(row: BillRow): string {
  return `${row.source}-${row.orderNo}`;
}

function buildNote(row: BillRow): string {
  const parts = [...new Set([row.counterparty, row.goods].filter((s) => s && s !== '/'))];
  let note = (row.refund ? ['退款', ...parts] : parts).join(' · ');
  if (row.refundedFen > 0 && row.netFen > 0) note += `（已退款 ¥${formatFen(row.refundedFen)}）`;
  return note.slice(0, NOTE_MAX);
}

/** 导入原始字段；去掉空值 */
export function buildMeta(row: BillRow, autoCategoryId: string): TxMeta {
  const meta: TxMeta = {
    counterparty: row.counterparty,
    goods: row.goods,
    method: row.method,
    status: row.status,
    merchantOrderNo: row.merchantOrderNo,
    billType: row.txType || row.billCategory,
    refundedFen: row.refundedFen || undefined,
    autoCategoryId,
  };
  for (const k of Object.keys(meta) as (keyof TxMeta)[]) if (meta[k] === '' || meta[k] === undefined) delete meta[k];
  return meta;
}

export function toTransaction(row: BillRow, categoryId: string, now: number): Transaction {
  return {
    id: txId(row),
    type: row.direction === 'income' ? 'income' : 'expense',
    amount: row.netFen,
    categoryId,
    accountId: DEFAULT_ACCOUNT_ID,
    occurredAt: row.time,
    note: buildNote(row) || undefined,
    createdAt: now,
    updatedAt: now,
    source: row.source,
    sourceOrderNo: row.orderNo,
    importedAmount: row.netFen,
    meta: buildMeta(row, categoryId),
  };
}

/**
 * 已导入记录的补全（详细设计 §2）：没有原始字段的补上；
 * 用户没改过分类时，把一级分类 / 「其他」细化为新规则给出的子分类。
 */
export function enrichFor(existing: Transaction, tx: Transaction, categories: Map<string, Category>): PlanItem['enrich'] {
  const out: NonNullable<PlanItem['enrich']> = {};
  const cur = existing.categoryId ?? '';
  const next = tx.categoryId ?? '';
  const auto = existing.meta?.autoCategoryId;
  const untouched = auto ? cur === auto : !categories.get(cur)?.parentId || OTHER_IDS.has(cur);
  const refines =
    cur !== next && (categories.get(next)?.parentId === cur || (OTHER_IDS.has(cur) && !OTHER_IDS.has(next)));
  if (untouched && refines) out.categoryId = next;
  if (!existing.meta || out.categoryId) out.meta = { ...tx.meta, autoCategoryId: out.categoryId ?? auto ?? cur };
  return out.meta || out.categoryId ? out : undefined;
}

export interface PlanContext {
  /** 本地已有的、id 与本次导入相同的记录（含已删除） */
  existing: Map<string, Transaction>;
  /** 时间范围内的手动记录（未删除、没有 source） */
  manual: Transaction[];
  rules: Rule[];
  categories: Map<string, Category>;
  now: number;
}

/**
 * 去重与导入计划（详细设计 §5）：
 * ① 交易单号固定 id ② 退款冲抵（解析阶段已算出净额）③ 金额变化时更新 ④ 与手动记录比对
 */
export function planImport(rows: BillRow[], ctx: PlanContext): PlanItem[] {
  const usedManual = new Set<string>();
  const seen = new Set<string>();
  return rows.map((row): PlanItem => {
    const id = txId(row);
    const tx = toTransaction(row, classify(row, ctx.rules, ctx.categories), ctx.now);
    const item = (kind: PlanKind, extra: Partial<PlanItem> = {}): PlanItem => ({ id, kind, row, tx, ...extra });

    if (seen.has(id)) return item('skip', { reason: '文件内重复' });
    seen.add(id);

    const existing = ctx.existing.get(id);
    if (existing) {
      if (existing.deleted) return row.skip ? item('skip', { reason: row.skip }) : item('deleted', { reason: '之前删除过', existing });
      const imported = existing.importedAmount ?? existing.amount;
      const enrich = enrichFor(existing, tx, ctx.categories);
      if (imported === row.netFen) return item('exists', { reason: '已导入过', existing, enrich });
      if (existing.amount !== imported) return item('exists', { reason: '已导入（金额已手动修改）', existing, enrich });
      return item('update', {
        enrich,
        reason: row.netFen === 0 ? '已全额退款，将删除' : `金额 ${formatFen(imported)} → ${formatFen(row.netFen)}`,
        existing,
      });
    }

    if (row.skip) return item('skip', { reason: row.skip });

    const manual = ctx.manual.find(
      (m) =>
        !usedManual.has(m.id) &&
        m.type === tx.type &&
        m.amount === tx.amount &&
        Math.abs(m.occurredAt - tx.occurredAt) <= SUSPECT_WINDOW,
    );
    if (manual) {
      usedManual.add(manual.id);
      return item('suspect', { reason: '疑似与手动记录重复', manual });
    }
    return item('new');
  });
}

export interface PlanSummary {
  counts: Record<PlanKind, number>;
  newTotal: { expense: number; income: number };
  /** 补全详情 / 细化分类的已有记录数 */
  enrich: { meta: number; category: number };
}

export function summarize(items: PlanItem[]): PlanSummary {
  const counts: Record<PlanKind, number> = { new: 0, update: 0, suspect: 0, exists: 0, deleted: 0, skip: 0 };
  const newTotal = { expense: 0, income: 0 };
  const enrich = { meta: 0, category: 0 };
  for (const it of items) {
    if (it.enrich?.meta) enrich.meta++;
    if (it.enrich?.categoryId) enrich.category++;
    counts[it.kind]++;
    if (it.kind === 'new') newTotal[it.tx.type === 'income' ? 'income' : 'expense'] += it.tx.amount;
  }
  return { counts, newTotal, enrich };
}
