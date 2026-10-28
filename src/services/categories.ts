import { db } from '@/db/schema';
import { PALETTE } from '@/db/seed';
import { uuid } from '@/domain/id';
import type { Category, CategoryType } from '@/domain/types';

export async function listCategories(type?: CategoryType, includeHidden = true): Promise<Category[]> {
  let list = await db.categories.toArray();
  if (type) list = list.filter((c) => c.type === type);
  if (!includeHidden) list = list.filter((c) => !c.hidden);
  return list.sort((a, b) => a.sort - b.sort);
}

function checkName(name: string, siblings: Category[], selfId?: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 8) throw new Error('名称需为 1–8 个字');
  if (siblings.some((c) => c.name === n && c.id !== selfId)) throw new Error('分类名称已存在');
  return n;
}

/** 同级分类：类型相同且上级相同 */
const sameLevel = (a: Pick<Category, 'type' | 'parentId'>) => (c: Category) =>
  c.type === a.type && (c.parentId ?? '') === (a.parentId ?? '');

export async function createCategory(input: {
  type: CategoryType;
  name: string;
  icon: string;
  parentId?: string;
}): Promise<string> {
  return db.transaction('rw', db.categories, async () => {
    const all = await db.categories.where('type').equals(input.type).toArray();
    let color = PALETTE[all.filter((c) => !c.parentId).length % PALETTE.length];
    if (input.parentId) {
      const parent = all.find((c) => c.id === input.parentId);
      if (!parent || parent.parentId) throw new Error('上级分类无效（只支持两级）');
      color = parent.color;
    }
    const siblings = all.filter(sameLevel(input));
    const name = checkName(input.name, siblings);
    const id = uuid();
    await db.categories.add({
      id,
      type: input.type,
      name,
      icon: input.icon,
      color,
      sort: Math.max(-1, ...siblings.map((c) => c.sort)) + 1,
      hidden: false,
      ...(input.parentId ? { parentId: input.parentId } : {}),
    });
    return id;
  });
}

export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'hidden'>>,
): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const cat = await db.categories.get(id);
    if (!cat) throw new Error('分类不存在');
    const changes = { ...patch };
    if (patch.name !== undefined) {
      const siblings = (await db.categories.where('type').equals(cat.type).toArray()).filter(sameLevel(cat));
      changes.name = checkName(patch.name, siblings, id);
    }
    await db.categories.update(id, changes);
  });
}

/** 与同级相邻分类交换位置，并把同级排序号整理为连续值 */
export async function moveCategory(id: string, dir: 'up' | 'down'): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    const cat = await db.categories.get(id);
    if (!cat) return;
    const list = (await listCategories(cat.type)).filter(sameLevel(cat));
    const i = list.findIndex((c) => c.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((c, idx) => (c.sort === idx ? null : db.categories.update(c.id, { sort: idx }))));
  });
}
