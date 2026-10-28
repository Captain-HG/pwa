import { HttpError } from './http';
import type { D1Like } from './types';

export const ENTITIES = ['transactions', 'categories', 'accounts', 'budgets', 'rules'] as const;
export type Entity = (typeof ENTITIES)[number];

export interface Change {
  entity: Entity;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface RemoteRecord extends Change {
  rev: number;
}

export const MAX_PUSH = 500;
export const MAX_RECORD_BYTES = 16 * 1024;
export const DEFAULT_PULL = 500;
export const MAX_PULL = 1000;

export function validateChanges(body: unknown): Change[] {
  const changes = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) throw new HttpError(400, 'changes 必须是数组');
  if (changes.length > MAX_PUSH) throw new HttpError(400, `单次最多推送 ${MAX_PUSH} 条`);
  return changes.map((c, i) => {
    const ok =
      c &&
      typeof c === 'object' &&
      ENTITIES.includes(c.entity) &&
      typeof c.id === 'string' &&
      c.id.length > 0 &&
      c.id.length <= 64 &&
      Number.isFinite(c.updatedAt) &&
      typeof c.deleted === 'boolean' &&
      c.data &&
      typeof c.data === 'object' &&
      !Array.isArray(c.data) &&
      c.data.id === c.id;
    if (!ok) throw new HttpError(400, `第 ${i + 1} 条记录格式错误`);
    if (JSON.stringify(c.data).length > MAX_RECORD_BYTES) throw new HttpError(400, `第 ${i + 1} 条记录过大`);
    return c as Change;
  });
}

/** 后写入者胜：只有 updatedAt 比云端新的记录才会写入并分配新的 rev。返回实际写入条数 */
export async function pushChanges(db: D1Like, userId: number, changes: Change[]): Promise<number> {
  if (!changes.length) return 0;
  const sql = `
    INSERT INTO records (user_id, entity, id, updated_at, deleted, data, rev)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(rev), 0) + 1 FROM records WHERE user_id = ?1))
    ON CONFLICT (user_id, entity, id) DO UPDATE SET
      updated_at = excluded.updated_at,
      deleted    = excluded.deleted,
      data       = excluded.data,
      rev        = excluded.rev
    WHERE excluded.updated_at > records.updated_at`;
  const results = await db.batch(
    changes.map((c) =>
      db.prepare(sql).bind(userId, c.entity, c.id, c.updatedAt, c.deleted ? 1 : 0, JSON.stringify(c.data)),
    ),
  );
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

export interface PullResult {
  records: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
}

export async function pullChanges(db: D1Like, userId: number, since: number, limit: number): Promise<PullResult> {
  const { results } = await db
    .prepare(
      `SELECT entity, id, updated_at, deleted, rev, data FROM records
        WHERE user_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3`,
    )
    .bind(userId, since, limit + 1)
    .all<{ entity: Entity; id: string; updated_at: number; deleted: number; rev: number; data: string }>();
  const hasMore = results.length > limit;
  const rows = hasMore ? results.slice(0, limit) : results;
  return {
    records: rows.map((r) => ({
      entity: r.entity,
      id: r.id,
      updatedAt: r.updated_at,
      deleted: r.deleted === 1,
      rev: r.rev,
      data: JSON.parse(r.data),
    })),
    cursor: rows.length ? rows[rows.length - 1].rev : since,
    hasMore,
  };
}

export function parsePullParams(url: URL): { since: number; limit: number } {
  const since = Number(url.searchParams.get('since') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_PULL);
  if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'since 参数错误');
  if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'limit 参数错误');
  return { since, limit: Math.min(limit, MAX_PULL) };
}
