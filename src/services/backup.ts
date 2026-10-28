import dayjs from 'dayjs';
import type { Table } from 'dexie';
import { db } from '@/db/schema';
import { ensureSeed } from '@/db/seed';
import { markRemote } from '@/db/tracking';
import type { Account, Budget, Category, Setting, Transaction } from '@/domain/types';
import { formatFen } from '@/domain/money';
import type { Rule } from '@/import/classify';
import { setSetting } from './settings';

export const APP_ID = 'my-ledger';
export const SCHEMA_VERSION = 1;
const LAST_BACKUP_KEY = 'lastBackupAt';
/** 只属于本机的设置，不进入备份 */
const LOCAL_ONLY_SETTINGS = new Set([LAST_BACKUP_KEY, 'syncCursor', 'lastSyncAt', 'me', 'ownerUserId']);

export interface BackupFile {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: number;
  data: {
    transactions: Transaction[];
    categories: Category[];
    accounts: Account[];
    budgets: Budget[];
    settings: Setting[];
    rules?: Rule[];
  };
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export async function buildBackup(): Promise<BackupFile> {
  const [transactions, categories, accounts, budgets, settings, rules] = await Promise.all([
    db.transactions.toArray(),
    db.categories.toArray(),
    db.accounts.toArray(),
    db.budgets.toArray(),
    db.settings.toArray(),
    db.rules.toArray(),
  ]);
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    data: {
      transactions: transactions.map(strip) as Transaction[],
      categories: categories.map(strip) as Category[],
      accounts: accounts.map(strip) as Account[],
      budgets: budgets.map(strip) as Budget[],
      settings: settings.filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)),
      rules: rules.map(strip) as Rule[],
    },
  };
}

export async function exportJsonBlob(): Promise<Blob> {
  return new Blob([JSON.stringify(await buildBackup())], { type: 'application/json' });
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function exportCsvBlob(): Promise<Blob> {
  const [txs, cats, accounts] = await Promise.all([
    db.transactions.filter((t) => !t.deleted).toArray(),
    db.categories.toArray(),
    db.accounts.toArray(),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const typeName = { expense: '支出', income: '收入', transfer: '转账' } as const;
  const lines = [['日期', '类型', '分类', '账户', '金额(元)', '备注'].join(',')];
  for (const t of txs.sort((a, b) => a.occurredAt - b.occurredAt)) {
    lines.push(
      [
        dayjs(t.occurredAt).format('YYYY-MM-DD HH:mm'),
        typeName[t.type],
        catName.get(t.categoryId ?? '') ?? '',
        accName.get(t.accountId) ?? '',
        formatFen(t.amount).replace(/,/g, ''),
        t.note ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // BOM 让 Excel 以 UTF-8 打开，避免中文乱码
  return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export const INVALID_BACKUP = '不是有效的备份文件';

export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(INVALID_BACKUP);
  }
  const f = obj as Partial<BackupFile> | null;
  const d = f?.data;
  const ok =
    f?.app === APP_ID &&
    typeof f.schemaVersion === 'number' &&
    f.schemaVersion <= SCHEMA_VERSION &&
    d &&
    Array.isArray(d.transactions) &&
    Array.isArray(d.categories) &&
    d.transactions.every(
      (t) =>
        typeof t?.id === 'string' &&
        Number.isInteger(t.amount) &&
        typeof t.occurredAt === 'number' &&
        ['expense', 'income', 'transfer'].includes(t.type),
    ) &&
    d.categories.every((c) => typeof c?.id === 'string' && typeof c.name === 'string');
  if (!ok) throw new Error(INVALID_BACKUP);
  return {
    ...(f as BackupFile),
    data: {
      transactions: d.transactions,
      categories: d.categories,
      accounts: Array.isArray(d.accounts) ? d.accounts : [],
      budgets: Array.isArray(d.budgets) ? d.budgets : [],
      settings: Array.isArray(d.settings) ? d.settings : [],
      rules: Array.isArray(d.rules) ? d.rules : [],
    },
  };
}

/** 导出 / 导入时去掉本地同步标记 */
function strip<T extends { dirty?: unknown }>(r: T): Omit<T, 'dirty'> {
  const { dirty: _dirty, ...rest } = r;
  return rest;
}

/**
 * 导入备份，整体在一个事务中执行，任何异常整体回滚。写入会被标记为待同步，随后推送到云端。
 * - overwrite：本机现有流水全部标记删除，再写入备份内容（updatedAt 取当前时间，确保覆盖云端）
 * - merge：流水按 id 比较 updatedAt 取新者；其他表本地不存在才写入
 */
export async function importBackup(file: BackupFile, mode: 'merge' | 'overwrite'): Promise<ImportResult> {
  const { transactions, categories, accounts, budgets } = file.data;
  const rules = file.data.rules ?? [];
  const result: ImportResult = { added: 0, updated: 0, skipped: 0 };

  await db.transaction('rw', db.allTables, async () => {
    if (mode === 'overwrite') {
      const now = Date.now();
      const keep = new Set(transactions.map((t) => t.id));
      await db.transactions
        .filter((t) => !t.deleted && !keep.has(t.id))
        .modify({ deleted: true, updatedAt: now });
      const fresh = <T extends { dirty?: unknown }>(items: T[]) => items.map((r) => ({ ...strip(r), updatedAt: now }));
      await db.transactions.bulkPut(fresh(transactions) as Transaction[]);
      await db.categories.bulkPut(fresh(categories) as Category[]);
      await db.accounts.bulkPut(fresh(accounts) as Account[]);
      await db.budgets.bulkPut(fresh(budgets) as Budget[]);
      await db.rules.bulkPut(fresh(rules) as Rule[]);
      result.added = transactions.length;
    } else {
      const existing = await db.transactions.bulkGet(transactions.map((t) => t.id));
      const toPut: Transaction[] = [];
      transactions.forEach((t, i) => {
        const local = existing[i];
        if (!local) {
          toPut.push(strip(t) as Transaction);
          result.added++;
        } else if (t.updatedAt > local.updatedAt) {
          toPut.push(strip(t) as Transaction);
          result.updated++;
        } else {
          result.skipped++;
        }
      });
      await db.transactions.bulkPut(toPut);
      await addMissing(db.categories, categories.map(strip) as Category[], (c) => c.id);
      await addMissing(db.accounts, accounts.map(strip) as Account[], (a) => a.id);
      await addMissing(db.budgets, budgets.map(strip) as Budget[], (b) => b.id);
      await addMissing(db.rules, rules.map(strip) as Rule[], (r) => r.id);
    }
    await ensureSeed();
  });
  return result;
}

async function addMissing<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<T, string, any>,
  items: T[],
  key: (item: T) => string,
): Promise<void> {
  const existing = await table.bulkGet(items.map(key));
  const missing = items.filter((_, i) => !existing[i]);
  if (missing.length) await table.bulkAdd(missing);
}

export async function markBackedUp(now = Date.now()): Promise<void> {
  await setSetting(LAST_BACKUP_KEY, now);
}

export { LAST_BACKUP_KEY };

/** 清空所有流水：全部标记删除并同步到云端，分类保留 */
export async function clearAllTransactions(): Promise<number> {
  return db.transactions.filter((t) => !t.deleted).modify({ deleted: true, updatedAt: Date.now() });
}

/** 清除本机全部数据（退出登录时使用，不影响云端） */
export async function wipeLocal(): Promise<void> {
  await db.transaction('rw', db.allTables, async (tx) => {
    markRemote(tx);
    await Promise.all(db.allTables.map((t) => t.clear()));
  });
}
