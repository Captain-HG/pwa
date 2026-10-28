<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import MonthSwitcher from '@/components/MonthSwitcher.vue';
import SummaryCard from '@/components/SummaryCard.vue';
import SyncReminder from '@/components/SyncReminder.vue';
import TxDayGroup from '@/components/TxDayGroup.vue';
import { useCategories } from '@/composables/useCategories';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Transaction } from '@/domain/types';
import { groupByDay, summarize } from '@/services/stats';
import { listByMonth } from '@/services/transactions';
import { useUiStore } from '@/stores/ui';
import { can } from '@/stores/auth';

const { month } = storeToRefs(useUiStore());
const txs = useLiveQuery(() => listByMonth(month.value), month, [] as Transaction[]);
const { get: getCategory } = useCategories();

const summary = computed(() => summarize(txs.value));
const groups = computed(() => groupByDay(txs.value));
</script>

<template>
  <div class="page with-tabbar">
    <div class="top">
      <MonthSwitcher v-model="month" />
      <van-icon name="search" size="20" class="search" @click="$router.push({ path: '/list', query: { month } })" />
    </div>
    <SummaryCard :summary="summary" />
    <SyncReminder />
    <TxDayGroup v-for="g in groups" :key="g.day" :group="g" :get-category="getCategory" />
    <van-empty v-if="!groups.length" :description="can('ledger.edit') ? '本月还没有记账，点 ＋ 记一笔' : '本月还没有记账'" />
  </div>
</template>

<style scoped>
.top {
  position: relative;
}
.search {
  position: absolute;
  right: 16px;
  top: 12px;
  padding: 4px;
  color: var(--text-2);
  cursor: pointer;
}
</style>
