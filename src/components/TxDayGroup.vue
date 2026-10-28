<script setup lang="ts">
import TxRow from './TxRow.vue';
import { formatFen } from '@/domain/money';
import type { Category } from '@/domain/types';
import type { DayGroup } from '@/services/stats';

defineProps<{ group: DayGroup; getCategory: (id?: string) => Category }>();
</script>

<template>
  <div class="card">
    <div class="day-head">
      <span>{{ group.label }}</span>
      <span class="muted num">
        <template v-if="group.expense">支出 {{ formatFen(group.expense) }}</template>
        <template v-if="group.income">&nbsp;&nbsp;收入 {{ formatFen(group.income) }}</template>
      </span>
    </div>
    <TxRow v-for="t in group.items" :key="t.id" :tx="t" :get-category="getCategory" />
  </div>
</template>

<style scoped>
.day-head {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
</style>
