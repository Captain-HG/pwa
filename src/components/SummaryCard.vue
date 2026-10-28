<script setup lang="ts">
import { formatFen } from '@/domain/money';
import type { MonthSummary } from '@/services/stats';

defineProps<{ summary: MonthSummary }>();
</script>

<template>
  <div class="summary">
    <div class="caption">本月支出</div>
    <div class="big num">{{ formatFen(summary.expense) }}</div>
    <div class="row num">
      <span>收入 {{ formatFen(summary.income) }}</span>
      <span>结余 {{ formatFen(summary.balance) }}</span>
    </div>
  </div>
</template>

<style scoped>
.summary {
  margin: 0 12px;
  padding: 18px 20px;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(135deg, #1989fa, #5aa9ff);
  box-shadow: 0 6px 16px rgba(25, 137, 250, 0.25);
}
.caption {
  font-size: 13px;
  opacity: 0.85;
}
.big {
  font-size: 32px;
  font-weight: 700;
  margin: 6px 0 10px;
}
.row {
  display: flex;
  gap: 24px;
  font-size: 13px;
  opacity: 0.9;
}
</style>
