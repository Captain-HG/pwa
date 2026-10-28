<script setup lang="ts">
import { computed } from 'vue';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { countPending, syncState } from '@/sync/sync';

const STALE_MS = 24 * 3_600_000;
const pending = useLiveQuery(countPending, null, 0);

// 有待同步数据，且超过 24 小时没有成功同步过
const show = computed(
  () => pending.value > 0 && (!syncState.lastSyncAt || Date.now() - syncState.lastSyncAt >= STALE_MS) && !syncState.syncing,
);
const text = computed(() => `有 ${pending.value} 条记录未同步到云端${syncState.error ? `（${syncState.error}）` : ''}`);
</script>

<template>
  <van-notice-bar v-if="show" class="reminder" left-icon="info-o" mode="link" :text="text" @click="$router.push('/account')" />
</template>

<style scoped>
.reminder {
  margin: 12px 12px 0;
  border-radius: 10px;
  cursor: pointer;
}
</style>
