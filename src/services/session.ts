import { api } from '@/api/client';
import { stopSync } from '@/sync/sync';
import { wipeLocal } from './backup';

export interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
}

export const getMe = () => api<{ username: string }>('/api/auth/me');
export const listSessions = () => api<{ sessions: SessionInfo[] }>('/api/auth/sessions').then((r) => r.sessions);
export const revokeSession = (id: string) => api(`/api/auth/sessions/${id}`, { method: 'DELETE' });
export const changePassword = (oldPassword: string, newPassword: string) =>
  api('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } });

let leaving = false;

/** 本机登出：清空本地数据与离线缓存，回到登录页（不影响云端数据） */
export async function logoutLocal(): Promise<void> {
  if (leaving) return;
  leaving = true;
  stopSync();
  await wipeLocal().catch(() => {});
  if ('serviceWorker' in navigator) {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }
  if ('caches' in window) {
    for (const k of await caches.keys()) await caches.delete(k);
  }
  location.replace('/login');
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  await logoutLocal();
}

/** 由 UA 粗略识别设备，用于设备列表 */
export function describeDevice(ua: string): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : '未知设备';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /CriOS|Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${os} · ${browser}` : os;
}
