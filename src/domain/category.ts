import type { Category } from './types';

/** 两级分类工具。子分类的 parentId 指向一级分类 */

export function rootOf(id: string | undefined, map: Map<string, Category>): Category | undefined {
  const c = id ? map.get(id) : undefined;
  if (!c) return undefined;
  return c.parentId ? (map.get(c.parentId) ?? c) : c;
}

export function rootId(id: string | undefined, map: Map<string, Category>): string | undefined {
  return rootOf(id, map)?.id ?? id;
}

export function childrenOf(parentId: string, list: Category[]): Category[] {
  return list.filter((c) => c.parentId === parentId).sort((a, b) => a.sort - b.sort);
}

/** 自身 + 子分类 */
export function descendantIds(id: string, list: Category[]): Set<string> {
  return new Set([id, ...list.filter((c) => c.parentId === id).map((c) => c.id)]);
}

/** 例如「交通 › 充电」 */
export function fullName(id: string | undefined, map: Map<string, Category>): string {
  const c = id ? map.get(id) : undefined;
  if (!c) return '未分类';
  const p = c.parentId ? map.get(c.parentId) : undefined;
  return p ? `${p.name} › ${c.name}` : c.name;
}

/** 一级分类（按排序） */
export function topLevel(list: Category[]): Category[] {
  return list.filter((c) => !c.parentId).sort((a, b) => a.sort - b.sort);
}
