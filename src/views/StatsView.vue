<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { EChartsCoreOption } from 'echarts/core';
import MonthSwitcher from '@/components/MonthSwitcher.vue';
import CategoryIcon from '@/components/CategoryIcon.vue';
import EChart from '@/components/EChart.vue';
import { useCategories } from '@/composables/useCategories';
import { useDark } from '@/composables/useDark';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatFen } from '@/domain/money';
import type { CategoryType, Transaction } from '@/domain/types';
import { byCategory, daily } from '@/services/stats';
import { listByMonth } from '@/services/transactions';
import { useUiStore } from '@/stores/ui';
import { useRouter } from 'vue-router';
import { rootId } from '@/domain/category';
import { can } from '@/stores/auth';

const { month } = storeToRefs(useUiStore());
const type = ref<CategoryType>('expense');
const txs = useLiveQuery(() => listByMonth(month.value), month, [] as Transaction[]);
const { get: getCategory, map: catMap, nameOf } = useCategories();
const isDark = useDark();
const router = useRouter();

/** 汇总口径：一级分类（子分类计入父分类）或子分类 */
const level = ref<'top' | 'sub'>('top');
const ranking = computed(() =>
  byCategory(txs.value, type.value, level.value === 'top' ? (id) => rootId(id, catMap.value) ?? id : undefined),
);
const label = (id: string) => (level.value === 'top' ? getCategory(id).name : nameOf(id));
const canDrill = computed(() => can('ledger.view'));

/** 下钻到筛选明细 */
function openCategory(categoryId: string) {
  if (!canDrill.value) return;
  router.push({ path: '/list', query: { month: month.value, type: type.value, category: categoryId } });
}

function onPieClick(p: { data: unknown }) {
  openCategory((p.data as { id: string }).id);
}

function openDay(index: number) {
  if (!canDrill.value || !days.value[index]) return;
  const day = `${month.value}-${String(index + 1).padStart(2, '0')}`;
  router.push({ path: '/list', query: { day, type: type.value } });
}
const total = computed(() => ranking.value.reduce((s, r) => s + r.amount, 0));
const days = computed(() => daily(txs.value, month.value, type.value));
const typeName = computed(() => (type.value === 'expense' ? '支出' : '收入'));
const mainColor = computed(() => (type.value === 'expense' ? '#ee0a24' : '#07c160'));
const textColor = computed(() => (isDark.value ? '#f5f5f5' : '#323233'));
const subColor = computed(() => (isDark.value ? '#8e8e93' : '#969799'));

const pieOption = computed<EChartsCoreOption>(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${formatFen(p.value)}（${p.percent}%）`,
  },
  title: {
    text: formatFen(total.value),
    subtext: '总' + typeName.value,
    left: 'center',
    top: '40%',
    textStyle: { fontSize: 18, color: textColor.value },
    subtextStyle: { color: subColor.value },
  },
  series: [
    {
      type: 'pie',
      radius: ['55%', '78%'],
      label: { show: false },
      itemStyle: { borderColor: isDark.value ? '#1c1c1e' : '#fff', borderWidth: 2 },
      data: ranking.value.map((r) => {
        const c = getCategory(r.categoryId);
        return { name: label(r.categoryId), value: r.amount, id: r.categoryId, itemStyle: { color: c.color } };
      }),
    },
  ],
}));

const barOption = computed<EChartsCoreOption>(() => ({
  grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
  tooltip: {
    trigger: 'axis',
    formatter: (ps: { name: string; value: number }[]) => `${month.value.slice(5)}-${ps[0].name.padStart(2, '0')}<br/>${formatFen(ps[0].value)}`,
  },
  xAxis: {
    type: 'category',
    data: days.value.map((_, i) => String(i + 1)),
    axisLabel: { color: subColor.value, interval: 4 },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: subColor.value } },
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: subColor.value, formatter: (v: number) => String(v / 100) },
    splitLine: { lineStyle: { color: isDark.value ? '#2c2c2e' : '#ebedf0' } },
  },
  series: [{ type: 'bar', data: days.value, itemStyle: { color: mainColor.value, borderRadius: [3, 3, 0, 0] } }],
}));
</script>

<template>
  <div class="page with-tabbar">
    <MonthSwitcher v-model="month" />
    <div class="type-row">
      <div class="seg">
        <button :class="{ on: type === 'expense' }" @click="type = 'expense'">支出</button>
        <button :class="{ on: type === 'income' }" @click="type = 'income'">收入</button>
      </div>
    </div>

    <van-empty v-if="!total" :description="`本月没有${typeName}记录`" />
    <template v-else>
      <div class="card">
        <EChart :option="pieOption" height="220px" @click="onPieClick" />
        <div class="level-row">
          <span :class="{ on: level === 'top' }" @click="level = 'top'">一级分类</span>
          <span :class="{ on: level === 'sub' }" @click="level = 'sub'">子分类</span>
        </div>
        <div v-for="r in ranking" :key="r.categoryId" class="rank" :class="{ clickable: canDrill }" @click="openCategory(r.categoryId)">
          <CategoryIcon :icon="getCategory(r.categoryId).icon" :color="getCategory(r.categoryId).color" :size="32" />
          <div class="rank-main">
            <div class="rank-line">
              <span>{{ label(r.categoryId) }} <span class="muted">{{ (r.ratio * 100).toFixed(1) }}%</span></span>
              <span class="num">{{ formatFen(r.amount) }}<van-icon v-if="canDrill" name="arrow" class="arrow" /></span>
            </div>
            <van-progress
              :percentage="r.ratio * 100"
              :show-pivot="false"
              :color="getCategory(r.categoryId).color"
              stroke-width="4"
            />
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">每日{{ typeName }}</div>
        <EChart :option="barOption" height="200px" @click="(p) => openDay(p.dataIndex)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.level-row {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  padding: 0 14px 4px;
  font-size: 12px;
  color: var(--text-2);
}
.level-row span {
  cursor: pointer;
}
.level-row .on {
  color: var(--primary);
  font-weight: 600;
}
.rank.clickable {
  cursor: pointer;
}
.arrow {
  margin-left: 4px;
  color: var(--text-2);
  font-size: 12px;
}
.type-row {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
}
.rank {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.rank-main {
  flex: 1;
}
.rank-line {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  margin-bottom: 6px;
}
.card-title {
  padding: 12px 14px 0;
  font-size: 14px;
  font-weight: 600;
}
</style>
