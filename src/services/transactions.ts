import dayjs from 'dayjs';
import { db } from '@/db/schema';
import { DEFAULT_ACCOUNT_ID } from '@/db/seed';
import { uuid } from '@/domain/id';
import type { Transaction, TxInput, TxMeta } from '@/domain/types';

/** 单笔上限 1 亿元 */
export const MAX_AMOUNT = 100_000_000 * 100;

function validate(input: TxInput): void {
  if (input.type !== 'expense' && input.type !== 'income') throw new Error('类型不正确');
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('请输入金额');
  if (input.amount > MAX_AMOUNT) throw new Error('金额过大');
  if (!input.categoryId) throw new Error('请选择分类');
  if (!Number.isFinite(input.occurredAt)) throw new Error('日期不正确');
}

function fields(input: TxInput) {
  return {
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId,
    accountId: input.accountId ?? DEFAULT_ACCOUNT_ID,
    occurredAt: input.occurredAt,
    note: input.note?.trim() || undefined,
  };
}

/** 合并交易对方 / 商品到 meta，保留导入的其他字段；全部为空时返回 undefined */
function mergeMeta(meta: TxMeta | undefined, input: TxInput): TxMeta | undefined {
  const next: TxMeta = { ...meta };
  for (const key of ['counterparty', 'goods'] as const) {
    if (input[key] === undefined) continue;
    const v = input[key]!.trim().slice(0, 100);
    if (v) next[key] = v;
    else delete next[key];
  }
  return Object.keys(next).length ? next : undefined;
}

export async function addTx(input: TxInput): Promise<string> {
  validate(input);
  const now = Date.now();
  const meta = mergeMeta(undefined, input);
  const tx: Transaction = { id: uuid(), ...fields(input), ...(meta ? { meta } : {}), createdAt: now, updatedAt: now };
  await db.transactions.add(tx);
  return tx.id;
}

export async function updateTx(id: string, input: TxInput): Promise<void> {
  validate(input);
  await db.transaction('rw', db.transactions, async () => {
    const cur = await db.transactions.get(id);
    if (!cur) throw new Error('记录不存在');
    await db.transactions.update(id, { ...fields(input), meta: mergeMeta(cur.meta, input), updatedAt: Date.now() });
  });
}

/** 软删除，为将来同步保留删除标记 */
export async function removeTx(id: string): Promise<void> {
  await db.transactions.update(id, { deleted: true, updatedAt: Date.now() });
}

export async function getTx(id: string): Promise<Transaction | undefined> {
  const tx = await db.transactions.get(id);
  return tx && !tx.deleted ? tx : undefined;
}

export function monthRange(month: string): [number, number] {
  const d = dayjs(month + '-01');
  return [d.startOf('month').valueOf(), d.endOf('month').valueOf()];
}

export function listByMonth(month: string): Promise<Transaction[]> {
  const [start, end] = monthRange(month);
  return db.transactions
    .where('occurredAt')
    .between(start, end, true, true)
    .filter((t) => !t.deleted)
    .toArray();
}

export function countAll(): Promise<number> {
  return db.transactions.filter((t) => !t.deleted).count();
}
