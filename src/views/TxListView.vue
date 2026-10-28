<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CategoryIcon from '@/components/CategoryIcon.vue';
import FilterPanel from '@/components/FilterPanel.vue';
import TxDayGroup from '@/components/TxDayGroup.vue';
import TxRow from '@/components/TxRow.vue';
import { useCategories } from '@/composables/useCategories';
import { useGoBack } from '@/composables/useGoBack';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { db } from '@/db/schema';
import { childrenOf } from '@/domain/category';
import { formatFen } from '@/domain/money';
import type { Transaction } from '@/domain/types';
import { groupByDay } from '@/services/stats';
import { applyFilter, describeFilter, parseFilter, SORTS, timeRange, toQuery, type TxFilter } from '@/services/txFilter';

/** 查询明细：搜索、筛选、排序。条件全部保存在网址参数中 */
const route = useRoute();
const router = useRouter();
const goBack = useGoBack();
const { all, get: getCategory, nameOf } = useCategories();

const filter = computed(() => parseFilter(route.query));

function update(f: TxFilter) {
  router.replace({ path: '/list', query: toQuery(f) });
}

// ---------- 数据 ----------
const range = computed(() => timeRange(filter.value));
const rangeKey = computed(() => JSON.stringify(range.value));
const source = useLiveQuery(
  () => {
    const r = range.value;
    const q = r ? db.transactions.where('occurredAt').between(r[0], r[1], true, true) : db.transactions.toCollection();
    return q.filter((t) => !t.deleted).toArray();
  },
  rangeKey,
  [] as Transaction[],
);
const base = computed(() => applyFilter(source.value, filter.value, all.value));

// 只选了一个一级分类时，显示子分类分布并可再细分（v1.4）
const singleTop = computed(() => {
  const ids = filter.value.categories;
  const c = ids.length === 1 ? getCategory(ids[0]) : undefined;
  return c && c.id && !c.parentId && childrenOf(c.id, all.value).length ? c : undefined;
});
const sub = ref('');
watch(() => route.fullPath, () => (sub.value = ''));
const txs = computed(() => (sub.value ? base.value.filter((t) => t.categoryId === sub.value) : base.value));

const totals = computed(() => {
  let expense = 0;
  let income = 0;
  for (const t of txs.value) t.type === 'income' ? (income += t.amount) : (expense += t.amount);
  return { expense, income };
});

const subStats = computed(() => {
  if (!singleTop.value) return [];
  const sums = new Map<string, { amount: number; count: number }>();
  for (const t of base.value) {
    const s = sums.get(t.categoryId!) ?? { amount: 0, count: 0 };
    s.amount += t.amount;
    s.count++;
    sums.set(t.categoryId!, s);
  }
  const total = base.value.reduce((s, t) => s + t.amount, 0) || 1;
  return [...sums.entries()]
    .map(([id, s]) => ({ id, ...s, ratio: s.amount / total, name: id === singleTop.value!.id ? '未细分' : getCategory(id).name }))
    .sort((a, b) => b.amount - a.amount);
});

const byTime = computed(() => filter.value.sort.startsWith('time'));
const groups = computed(() => {
  const g = groupByDay(txs.value);
  return filter.value.sort === 'time_asc' ? g.reverse().map((d) => ({ ...d, items: [...d.items].reverse() })) : g;
});

// ---------- 搜索（防抖） ----------
const keyword = ref(filter.value.q);
watch(() => filter.value.q, (q) => (keyword.value = q));
let timer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => q.trim() !== filter.value.q && update({ ...filter.value, q: q.trim() }), 300);
});

// ---------- 条件、排序 ----------
const chips = computed(() => describeFilter(filter.value, nameOf));
const showFilter = ref(false);
const showSort = ref(false);
const sortLabel = computed(() => SORTS.find((s) => s.key === filter.value.sort)!.label);
function onSort(a: { key: TxFilter['sort'] }) {
  update({ ...filter.value, sort: a.key });
}
const sortActions = computed(() => SORTS.map((s) => ({ name: s.label, key: s.key, color: s.key === filter.value.sort ? '#1989fa' : undefined })));

const title = computed(() => {
  const f = filter.value;
  const onlyMonthAndCategory = f.month && f.categories.length === 1 && !f.q && !f.sources.length && f.minFen === undefined && f.maxFen === undefined;
  if (onlyMonthAndCategory) return `${getCategory(f.categories[0]).name} · ${dayjs(f.month + '-01').format('YYYY年M月')}`;
  if (f.range === 'custom' && f.from && f.from === f.to && !f.categories.length) return `${dayjs(f.from).format('M月D日')} 明细`;
  return '查询明细';
});
</script>

<template>
  <div class="page">
    <van-nav-bar :title="title" left-arrow right-text="筛选" @click-left="goBack" @click-right="showFilter = true" />

    <div class="search-bar">
      <van-search v-model="keyword" placeholder="搜索备注、交易对方、商品、分类" shape="round" class="search" />
    </div>

    <div v-if="chips.length" class="chip-row">
      <span v-for="c in chips" :key="c.key" class="chip" @click="update(c.remove(filter))">{{ c.label }} ✕</span>
      <span class="reset" @click="update({ ...parseFilter({}), sort: filter.sort })">重置</span>
    </div>

    <div class="card summary">
      <div class="sum-row num">
        <div><span class="muted small">支出</span><b>{{ formatFen(totals.expense) }}</b></div>
        <div><span class="muted small">收入</span><b class="income">{{ formatFen(totals.income) }}</b></div>
        <div><span class="muted small">笔数</span><b>{{ txs.length }}</b></div>
      </div>
      <div class="sort" @click="showSort = true">排序：{{ sortLabel }} <van-icon name="arrow-down" size="10" /></div>
    </div>

    <div v-if="subStats.length" class="card subs">
      <div class="sub" :class="{ on: !sub }" @click="sub = ''">
        <span class="sub-name">全部</span>
        <span class="muted num">{{ formatFen(base.reduce((s, t) => s + t.amount, 0)) }}</span>
      </div>
      <div v-for="s in subStats" :key="s.id" class="sub" :class="{ on: sub === s.id }" @click="sub = sub === s.id ? '' : s.id">
        <CategoryIcon :icon="getCategory(s.id).icon" :color="getCategory(s.id).color" :size="24" />
        <span class="sub-name">{{ s.name }}</span>
        <span class="muted small">{{ s.count }} 笔 · {{ (s.ratio * 100).toFixed(1) }}%</span>
        <span class="num">{{ formatFen(s.amount) }}</span>
      </div>
    </div>

    <template v-if="byTime">
      <TxDayGroup v-for="g in groups" :key="g.day" :group="g" :get-category="getCategory" />
    </template>
    <div v-else-if="txs.length" class="card">
      <TxRow v-for="t in txs" :key="t.id" :tx="t" :get-category="getCategory" show-date />
    </div>
    <van-empty v-if="!txs.length" description="没有符合条件的记录" />

    <FilterPanel v-model:show="showFilter" :filter="filter" :categories="all" @apply="update" />
    <van-action-sheet
      v-model:show="showSort"
      :actions="sortActions"
      cancel-text="取消"
      close-on-click-action
      @select="onSort"
    />
  </div>
</template>

<style scoped>
.search-bar {
  padding: 0 4px;
}
.search {
  background: transparent;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 12px 4px;
  align-items: center;
}
.chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--card);
  color: var(--primary);
  cursor: pointer;
}
.reset {
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  margin-left: 4px;
}
.summary {
  padding: 12px 16px 10px;
}
.sum-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  text-align: center;
}
.sum-row b {
  display: block;
  font-size: 17px;
  margin-top: 2px;
}
.small {
  font-size: 12px;
}
.sort {
  text-align: right;
  font-size: 12px;
  color: var(--primary);
  margin-top: 8px;
  cursor: pointer;
}
.subs {
  padding: 4px 0;
}
.sub {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font-size: 14px;
  cursor: pointer;
}
.sub.on {
  background: var(--bg);
  font-weight: 600;
}
.sub-name {
  flex: 1;
}
</style>
