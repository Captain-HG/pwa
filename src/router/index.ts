import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import { canRoute, firstAllowedRoute } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    tab?: boolean;
  }
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView, meta: { tab: true } },
    { path: '/stats', component: () => import('@/views/StatsView.vue'), meta: { tab: true } },
    { path: '/settings', component: () => import('@/views/SettingsView.vue'), meta: { tab: true } },
    { path: '/add', component: () => import('@/views/EditView.vue') },
    { path: '/edit/:id', component: () => import('@/views/EditView.vue') },
    { path: '/tx/:id', component: () => import('@/views/TxDetailView.vue') },
    { path: '/list', component: () => import('@/views/TxListView.vue') },
    { path: '/categories', component: () => import('@/views/CategoryView.vue') },
    { path: '/account', component: () => import('@/views/AccountView.vue') },
    { path: '/backup', component: () => import('@/views/BackupView.vue') },
    { path: '/import', component: () => import('@/views/ImportView.vue') },
    { path: '/admin/users', component: () => import('@/views/admin/UsersView.vue') },
    { path: '/admin/roles', component: () => import('@/views/admin/RolesView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

// 没有页面权限时跳到第一个有权限的页面（服务端另有接口级校验）
router.beforeEach((to) => {
  if (!canRoute(to.path)) {
    const target = firstAllowedRoute();
    return target === to.path ? true : target;
  }
  return true;
});
