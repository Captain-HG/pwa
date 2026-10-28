import Dexie, { type Transaction as DexieTransaction } from 'dexie';

/** 参与云同步的表 */
export const SYNCED_TABLES = ['transactions', 'categories', 'accounts', 'budgets', 'rules'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

const REMOTE = '__remote';

/** 标记当前事务为「应用云端数据 / 同步内部写入」：钩子不会把记录标记为待同步 */
export function markRemote(tx: DexieTransaction): void {
  (tx as unknown as Record<string, boolean>)[REMOTE] = true;
}

function isRemote(tx: DexieTransaction): boolean {
  return Boolean((tx as unknown as Record<string, boolean>)[REMOTE]);
}

let onLocalChange: () => void = () => {};

/** 本地写入提交后回调（用于触发同步） */
export function setLocalChangeListener(fn: () => void): void {
  onLocalChange = fn;
}

type Tracked = { updatedAt?: number; dirty?: 0 | 1 };

/**
 * 本地写入时自动维护 updatedAt 与 dirty，业务代码无需关心同步。
 * - creating：未指定 updatedAt 时补当前时间，dirty = 1
 * - updating：追加 updatedAt = now（修改里显式给了则保留）与 dirty = 1
 */
export function installTracking(db: Dexie): void {
  for (const name of SYNCED_TABLES) {
    const table = db.table(name);
    table.hook('creating', function (_key, obj: Tracked, tx) {
      if (isRemote(tx)) {
        obj.dirty = 0;
        return;
      }
      if (obj.updatedAt === undefined) obj.updatedAt = Date.now();
      obj.dirty = 1;
      this.onsuccess = () => onLocalChange();
    });
    table.hook('updating', function (mods: Partial<Tracked>, _key, _obj, tx) {
      if (isRemote(tx)) return undefined;
      this.onsuccess = () => onLocalChange();
      return 'updatedAt' in mods ? { dirty: 1 } : { updatedAt: Date.now(), dirty: 1 };
    });
  }
}
