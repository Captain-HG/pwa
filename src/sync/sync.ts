import { reactive } from 'vue';
import type { Table } from 'dexie';
import { api, ApiError } from '@/api/client';
import { db } from '@/db/schema';
import { markRemote, setLocalChangeListener, SYNCED_TABLES, type SyncedTable } from '@/db/tracking';
import { getSetting, setSetting } from '@/services/settings';
import { auth } from '@/stores/auth';
import { canAny, PULL_PERMISSIONS, PUSH_PERMISSIONS } from '../../shared/permissions';

/** 与 server/sync.ts 的 Change 一致 */
export interface Change {
  entity: SyncedTable;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

interface RemoteRecord extends Change {
  rev: number;
}

interface PullResult {
  records: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
}

type Row = { id: string; updatedAt?: number; dirty?: 0 | 1; deleted?: boolean };

const PUSH_BATCH = 200;
const PULL_LIMIT = 500;
export const CURSOR_KEY = 'syncCursor';
export const LAST_SYNC_KEY = 'lastSyncAt';

export const syncState = reactive({
  syncing: false,
  lastSyncAt: undefined as number | undefined,
  error: '',
});

function table(name: SyncedTable): Table<Row, string> {
  return db.table(name);
}

export async function countPending(): Promise<number> {
  const counts = await Promise.all(SYNCED_TABLES.map((n) => table(n).where('dirty').equals(1).count()));
  return counts.reduce((a, b) => a + b, 0);
}

export async function collectChanges(): Promise<Change[]> {
  const out: Change[] = [];
  for (const name of SYNCED_TABLES) {
    const rows = await table(name).where('dirty').equals(1).toArray();
    for (const { dirty: _dirty, ...data } of rows) {
      out.push({ entity: name, id: data.id, updatedAt: data.updatedAt ?? 0, deleted: Boolean(data.deleted), data });
    }
  }
  return out;
}

/** 推送成功后清除 dirty；推送期间又被改过（updatedAt 变了）的记录保留，下一轮再推 */
async function markClean(changes: Change[]): Promise<void> {
  await db.transaction('rw', db.syncedTables, async (tx) => {
    markRemote(tx);
    for (const c of changes) {
      const cur = await table(c.entity).get(c.id);
      if (cur?.dirty && cur.updatedAt === c.updatedAt) await table(c.entity).update(c.id, { dirty: 0 });
    }
  });
}

/** 没拿到用户信息时（离线首启）不做权限过滤，由服务端最终校验 */
const allowed = (keys: string[]) => !auth.me || canAny(auth.me.permissions, keys);

export async function push(): Promise<number> {
  const changes = (await collectChanges()).filter((c) => allowed(PUSH_PERMISSIONS[c.entity] ?? []));
  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const chunk = changes.slice(i, i + PUSH_BATCH);
    await api('/api/sync/push', { method: 'POST', body: { changes: chunk } });
    await markClean(chunk);
  }
  return changes.length;
}

/** 应用云端记录：本地有更新的未同步修改时保留本地，否则以云端为准 */
export async function applyRemote(records: RemoteRecord[]): Promise<void> {
  await db.transaction('rw', db.syncedTables, async (tx) => {
    markRemote(tx);
    for (const r of records) {
      if (!SYNCED_TABLES.includes(r.entity)) continue;
      const t = table(r.entity);
      const local = await t.get(r.id);
      if (local?.dirty && (local.updatedAt ?? 0) > r.updatedAt) continue;
      await t.put({ ...(r.data as Row), id: r.id, updatedAt: r.updatedAt, dirty: 0 });
    }
  });
}

export async function pull(): Promise<number> {
  if (!allowed(PULL_PERMISSIONS)) return 0;
  let cursor = (await getSetting<number>(CURSOR_KEY)) ?? 0;
  let total = 0;
  for (;;) {
    const res = await api<PullResult>(`/api/sync/pull?since=${cursor}&limit=${PULL_LIMIT}`);
    await applyRemote(res.records);
    total += res.records.length;
    cursor = res.cursor;
    await setSetting(CURSOR_KEY, cursor);
    if (!res.hasMore) return total;
  }
}

let running: Promise<void> | null = null;
let again = false;

/** push → pull。同一时间只跑一个；运行中再次调用会在结束后补跑一轮 */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    syncState.syncing = true;
    try {
      do {
        again = false;
        await push();
        await pull();
      } while (again);
      syncState.lastSyncAt = Date.now();
      syncState.error = '';
      await setSetting(LAST_SYNC_KEY, syncState.lastSyncAt);
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof TypeError)) console.error(e);
      syncState.error = e instanceof ApiError ? e.message : '网络不可用，稍后重试';
    } finally {
      syncState.syncing = false;
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSync(delay = 2000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

let stopped = false;

/** 停止自动同步（退出登录时） */
export function stopSync(): void {
  stopped = true;
  clearTimeout(timer);
  setLocalChangeListener(() => {});
}

/** 启动自动同步：启动时、本地修改后、回到前台、网络恢复、每 5 分钟 */
export async function startSync(): Promise<void> {
  syncState.lastSyncAt = await getSetting<number>(LAST_SYNC_KEY);
  setLocalChangeListener(() => scheduleSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stopped) void syncNow();
  });
  window.addEventListener('online', () => !stopped && void syncNow());
  setInterval(() => !stopped && void syncNow(), 5 * 60_000);
  void syncNow();
}
