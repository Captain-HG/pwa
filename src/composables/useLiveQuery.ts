import { liveQuery } from 'dexie';
import { onScopeDispose, shallowRef, watch, type Ref, type WatchSource } from 'vue';

/** 订阅 Dexie 查询，数据库变化时自动刷新；source 变化时重新订阅 */
export function useLiveQuery<T>(querier: () => T | Promise<T>, source: WatchSource | null, initial: T): Ref<T> {
  const result = shallowRef(initial) as Ref<T>;
  let sub: { unsubscribe(): void } | undefined;
  const start = () => {
    sub?.unsubscribe();
    sub = liveQuery(querier).subscribe({
      next: (v) => (result.value = v),
      error: (e) => console.error(e),
    });
  };
  if (source) watch(source, start, { immediate: true });
  else start();
  onScopeDispose(() => sub?.unsubscribe());
  return result;
}
