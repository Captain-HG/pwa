/**
 * 未登录时请求 /sw.js 返回的「自我注销」脚本。
 *
 * Service Worker 脚本不允许经过重定向，如果把 /sw.js 也重定向到登录页，
 * 已安装的旧版本（或会话过期的设备）会更新失败，永远停留在缓存的旧页面上。
 * 这个脚本被安装后：清空离线缓存 → 注销自己 → 刷新页面，之后请求走网络进入登录页。
 * 本地 IndexedDB 数据不受影响，登录后会照常同步。
 */
const SCRIPT = `// ledger: unauthenticated service worker kill switch
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try { await client.navigate(client.url); } catch (e) { /* 用户下次打开时生效 */ }
    }
  })());
});
`;

export function swKillSwitch(): Response {
  return new Response(SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
