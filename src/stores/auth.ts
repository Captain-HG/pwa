import { reactive } from 'vue';
import { api } from '@/api/client';
import { ensureSeed } from '@/db/seed';
import { wipeLocal } from '@/services/backup';
import { getSetting, setSetting } from '@/services/settings';
import { can as hasPerm, canAny, routePermissions } from '../../shared/permissions';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
}

export const ME_KEY = 'me';
export const OWNER_KEY = 'ownerUserId';

/** 还没拿到用户信息（首次离线启动）时的临时权限：只能使用自己的本地账本 */
const OFFLINE_DEFAULT = ['ledger.view', 'ledger.edit', 'stats.view'];

export const auth = reactive({ me: null as Me | null });

const perms = () => auth.me?.permissions ?? OFFLINE_DEFAULT;

export const can = (key: string) => hasPerm(perms(), key);
export const canRoute = (path: string) => canAny(perms(), routePermissions(path));

/** 没有目标页面权限时跳转的页面（设置页所有人都能进） */
export function firstAllowedRoute(): string {
  return ['/', '/stats', '/settings'].find(canRoute) ?? '/settings';
}

/**
 * 本机数据属于哪个用户。登录用户与本机数据的主人不同（例如 A 的会话过期后 B 在这台设备登录）时，
 * 先清空本机再从云端拉取，避免看到或上传别人的数据。首次记录时保留现有数据。
 */
async function ensureOwner(me: Me): Promise<void> {
  const owner = await getSetting<number>(OWNER_KEY);
  if (owner !== undefined && owner !== me.id) {
    await wipeLocal();
    await ensureSeed();
  }
  await setSetting(OWNER_KEY, me.id);
}

/** 读取当前用户：先用本机缓存，再向服务端刷新（离线时保持缓存） */
export async function loadMe(): Promise<void> {
  auth.me ??= (await getSetting<Me>(ME_KEY)) ?? null;
  try {
    const me = await api<Me>('/api/auth/me');
    await ensureOwner(me);
    auth.me = me;
    await setSetting(ME_KEY, me);
  } catch {
    // 离线或会话失效（401 会由 onUnauthorized 处理）
  }
}
