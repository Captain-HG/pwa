<script setup lang="ts">
import { can } from '@/stores/auth';
</script>

<template>
  <nav class="tabbar">
    <router-link v-if="can('ledger.view')" to="/" class="tab" exact-active-class="active">
      <van-icon name="bill-o" size="22" />
      <span>明细</span>
    </router-link>
    <router-link v-if="can('ledger.edit')" to="/add" class="plus" aria-label="记一笔">
      <van-icon name="plus" size="26" />
    </router-link>
    <router-link v-if="can('stats.view')" to="/stats" class="tab" active-class="active">
      <van-icon name="chart-trending-o" size="22" />
      <span>统计</span>
    </router-link>
    <router-link to="/settings" class="tab" active-class="active">
      <van-icon name="setting-o" size="22" />
      <span>设置</span>
    </router-link>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  height: calc(var(--tabbar-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  display: flex;
  align-items: center;
  background: var(--card);
  border-top: 1px solid var(--border);
  z-index: 10;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-2);
  text-decoration: none;
}
.tab.active {
  color: var(--primary);
}
.plus {
  flex: 1;
  display: flex;
  justify-content: center;
  text-decoration: none;
}
.plus :deep(.van-icon) {
  width: 48px;
  height: 48px;
  line-height: 48px;
  text-align: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  margin-top: -18px;
  box-shadow: 0 4px 12px rgba(25, 137, 250, 0.4);
}
</style>
