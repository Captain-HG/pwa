import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant, { showConfirmDialog } from 'vant';
import 'vant/lib/index.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import { ensureSeed } from './db/seed';
import { onUnauthorized } from './api/client';
import { logoutLocal } from './services/session';
import { startSync } from './sync/sync';
import { loadMe } from './stores/auth';
import './styles/global.css';

async function bootstrap() {
  await ensureSeed();
  // 申请持久化存储，降低被系统清理的概率
  navigator.storage?.persist?.().catch(() => {});

  // 会话失效或本设备被移除：清除本机数据并回到登录页
  onUnauthorized(() => void logoutLocal());
  // 先确定当前用户（权限、本机数据归属），再渲染页面和同步
  await loadMe();

  createApp(App).use(createPinia()).use(router).use(Vant).mount('#app');
  void startSync();
  // 回到前台时刷新权限（管理员可能调整了角色）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadMe();
  });

  const updateSW = registerSW({
    onNeedRefresh() {
      showConfirmDialog({ title: '有新版本', message: '是否立即刷新？', confirmButtonText: '刷新' })
        .then(() => updateSW(true))
        .catch(() => {});
    },
  });
}

bootstrap();
