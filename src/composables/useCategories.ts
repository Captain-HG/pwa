import { computed } from 'vue';
import type { Category } from '@/domain/types';
import { fullName } from '@/domain/category';
import { listCategories } from '@/services/categories';
import { useLiveQuery } from './useLiveQuery';

const UNKNOWN: Category = { id: '', type: 'expense', name: '未分类', icon: '📦', color: '#969799', sort: 0, hidden: false };

export function useCategories() {
  const all = useLiveQuery(() => listCategories(), null, [] as Category[]);
  const map = computed(() => new Map(all.value.map((c) => [c.id, c])));
  const get = (id?: string) => (id && map.value.get(id)) || UNKNOWN;
  /** 例如「交通 › 充电」 */
  const nameOf = (id?: string) => fullName(id, map.value);
  return { all, map, get, nameOf };
}
