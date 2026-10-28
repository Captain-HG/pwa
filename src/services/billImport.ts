import { db } from '@/db/schema';
import { ruleId } from '@/import/classify';
import { parseBill } from '@/import/parse';
import { planImport, SUSPECT_WINDOW, txId, type PlanItem } from '@/import/plan';
import { readTable } from '@/import/read';
import type { ParsedBill } from '@/import/types';
import type { Transaction } from '@/domain/types';

export interface PreparedImport {
  bill: ParsedBill;
  items: PlanItem[];
}

/** 读取并解析账单，与本地数据比对生成导入计划（文件只在本机解析） */
export async function prepareImport(file: Blob): Promise<PreparedImport> {
  const bill = parseBill(readTable(new Uint8Array(await file.arrayBuffer())));
  const ids = bill.rows.map(txId);
  const found = await db.transactions.bulkGet(ids);
  const existing = new Map<string, Transaction>();
  found.forEach((t) => t && existing.set(t.id, t));

  const start = (bill.start ?? 0) - SUSPECT_WINDOW;
  const end = (bill.end ?? 0) + SUSPECT_WINDOW;
  const manual = await db.transactions
    .where('occurredAt')
    .between(start, end, true, true)
    .filter((t) => !t.deleted && !t.source)
    .toArray();

  const [rules, categories] = await Promise.all([db.rules.toArray(), db.categories.toArray()]);
  const items = planImport(bill.rows, {
    existing,
    manual,
    rules,
    categories: new Map(categories.map((c) => [c.id, c])),
    now: Date.now(),
  });
  return { bill, items };
}

/** 预览中按「交易对方」分组调整分类时使用的分组键 */
export function groupKey(item: PlanItem): string {
  return item.row.counterparty || item.row.goods || '（无交易对方）';
}

export interface ApplyOptions {
  /** 要写入的新增 / 疑似重复 / 恢复已删除记录的 id */
  include: Set<string>;
  /** 分组键 → 分类 id（用户在预览中修改的） */
  overrides: Map<string, string>;
}

export interface ApplyResult {
  added: number;
  updated: number;
  removed: number;
  rules: number;
  /** 补全详情 / 细化分类的已有记录 */
  enriched: number;
  /** 恢复的已删除记录 */
  restored: number;
}

/** 一个事务写入：新增、金额更新、用户规则；钩子会把它们标记为待同步 */
export async function applyImport(items: PlanItem[], opts: ApplyOptions): Promise<ApplyResult> {
  const result: ApplyResult = { added: 0, updated: 0, removed: 0, rules: 0, enriched: 0, restored: 0 };
  const categories = new Map((await db.categories.toArray()).map((c) => [c.id, c]));

  await db.transaction('rw', db.transactions, db.rules, async () => {
    const toAdd: Transaction[] = [];
    for (const it of items) {
      const restore = it.kind === 'deleted' && opts.include.has(it.id);
      if (restore) result.restored++;
      if ((it.kind === 'new' || it.kind === 'suspect' || restore) && opts.include.has(it.id)) {
        const override = opts.overrides.get(groupKey(it));
        const valid = override && categories.get(override)?.type === it.tx.type;
        // 复制为普通对象：界面层可能传入响应式代理，IndexedDB 无法存储
        toAdd.push({
          ...it.tx,
          ...(it.tx.meta ? { meta: { ...it.tx.meta } } : {}),
          ...(valid ? { categoryId: override } : {}),
          // 恢复的记录必须比删除标记更新，同步时才能覆盖云端
          ...(restore ? { updatedAt: Math.max(Date.now(), (it.existing?.updatedAt ?? 0) + 1) } : {}),
        });
      }
      if (it.enrich && it.existing && !it.existing.deleted && it.kind !== 'deleted') {
        await db.transactions.update(it.id, {
          ...(it.enrich.meta ? { meta: { ...it.enrich.meta } } : {}),
          ...(it.enrich.categoryId ? { categoryId: it.enrich.categoryId } : {}),
        });
        result.enriched++;
      }
      if (it.kind === 'update' && it.existing) {
        if (it.row.netFen === 0) {
          await db.transactions.update(it.id, { deleted: true, importedAmount: 0 });
          result.removed++;
        } else {
          await db.transactions.update(it.id, { amount: it.row.netFen, importedAmount: it.row.netFen, note: it.tx.note });
          result.updated++;
        }
      }
    }
    // 恢复的记录整条覆盖（不带 deleted 标记，updatedAt 为当前时间，同步后覆盖云端的删除标记）
    await db.transactions.bulkPut(toAdd);
    result.added = toAdd.length - result.restored;

    // 用户在预览中改过的分类保存为规则，下次导入自动命中
    for (const [keyword, categoryId] of opts.overrides) {
      if (keyword.startsWith('（')) continue;
      await db.rules.put({ id: ruleId(keyword), keyword, categoryId });
      result.rules++;
    }
  });
  return result;
}
