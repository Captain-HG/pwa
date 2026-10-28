import Dexie, { type EntityTable } from 'dexie';
import type { Account, Budget, Category, Setting, Transaction } from '@/domain/types';
import type { Rule } from '@/import/classify';
import { installTracking, markRemote } from './tracking';

export class LedgerDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  rules!: EntityTable<Rule, 'id'>;

  constructor(name = 'my-ledger') {
    super(name);
    this.version(1).stores({
      transactions: 'id, occurredAt, [type+occurredAt], categoryId, accountId, updatedAt',
      categories: 'id, type, sort',
      accounts: 'id, sort',
      budgets: 'id, month, [month+categoryId]',
      settings: 'key',
    });
    // v1.1：云同步。已有数据全部标记待上传；分类等补一个很小的 updatedAt，让云端已有版本优先
    this.version(2)
      .stores({
        transactions: 'id, occurredAt, [type+occurredAt], categoryId, accountId, updatedAt, dirty',
        categories: 'id, type, sort, dirty',
        accounts: 'id, sort, dirty',
        budgets: 'id, month, [month+categoryId], dirty',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        markRemote(tx);
        await tx.table('transactions').toCollection().modify((r) => {
          r.dirty = 1;
        });
        for (const name of ['categories', 'accounts', 'budgets']) {
          await tx.table(name).toCollection().modify((r) => {
            r.updatedAt ??= 1;
            r.dirty = 1;
          });
        }
      });
    // v1.3：账单导入的用户分类规则
    this.version(3).stores({ rules: 'id, dirty' });
    installTracking(this);
  }

  get allTables() {
    return [this.transactions, this.categories, this.accounts, this.budgets, this.rules, this.settings];
  }

  get syncedTables() {
    return [this.transactions, this.categories, this.accounts, this.budgets, this.rules];
  }
}

export const db = new LedgerDB();
