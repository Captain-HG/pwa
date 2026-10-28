<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { childrenOf, topLevel } from '@/domain/category';
import { fenToInput, yuanToFen } from '@/domain/money';
import type { Category } from '@/domain/types';
import { emptyFilter, RANGES, SOURCES, type TxFilter } from '@/services/txFilter';

/** 筛选面板：编辑一份草稿，点「确定」才生效 */
const props = defineProps<{ filter: TxFilter; categories: Category[] }>();
const show = defineModel<boolean>('show', { required: true });
const emit = defineEmits<{ apply: [filter: TxFilter] }>();

const draft = ref<TxFilter>(emptyFilter());
const min = ref<string | number>('');
const max = ref<string | number>('');

watch(show, (open) => {
  if (!open) return;
  draft.value = { ...props.filter, categories: [...props.filter.categories], sources: [...props.filter.sources] };
  // 指定月份（统计下钻）在面板中按「自定义」展示
  if (draft.value.month) {
    const m = draft.value.month;
    draft.value = { ...draft.value, month: undefined, range: 'custom', from: `${m}-01`, to: dayEnd(m) };
  }
  min.value = draft.value.minFen !== undefined ? fenToInput(draft.value.minFen) : '';
  max.value = draft.value.maxFen !== undefined ? fenToInput(draft.value.maxFen) : '';
});

function dayEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

const groups = computed(() => {
  const types = draft.value.type ? [draft.value.type] : (['expense', 'income'] as const);
  return types.map((type) => ({
    type,
    label: type === 'expense' ? '支出分类' : '收入分类',
    tops: topLevel(props.categories.filter((c) => c.type === type && !c.hidden)),
  }));
});

const sel = computed(() => new Set(draft.value.categories));
const kids = (t: Category) => childrenOf(t.id, props.categories).filter((c) => !c.hidden);
const topActive = (t: Category) => sel.value.has(t.id) || kids(t).some((k) => sel.value.has(k.id));

/** 选一级分类 = 包含全部子分类；再点子分类则只保留所选子分类 */
function toggleTop(t: Category) {
  const ids = new Set([t.id, ...kids(t).map((k) => k.id)]);
  draft.value.categories = topActive(t)
    ? draft.value.categories.filter((id) => !ids.has(id))
    : [...draft.value.categories, t.id];
}

/** 选回整个一级分类（含全部子分类） */
function selectWhole(t: Category) {
  const ids = new Set([t.id, ...kids(t).map((k) => k.id)]);
  draft.value.categories = [...draft.value.categories.filter((id) => !ids.has(id)), t.id];
}

function toggleSub(t: Category, s: Category) {
  let list = draft.value.categories.filter((id) => id !== t.id);
  list = list.includes(s.id) ? list.filter((id) => id !== s.id) : [...list, s.id];
  draft.value.categories = list;
}

function toggleSource(key: TxFilter['sources'][number]) {
  const s = draft.value.sources;
  draft.value.sources = s.includes(key) ? s.filter((x) => x !== key) : [...s, key];
}

function setType(type?: TxFilter['type']) {
  draft.value.type = type;
  // 去掉与类型不符的分类
  if (type) draft.value.categories = draft.value.categories.filter((id) => props.categories.find((c) => c.id === id)?.type === type);
}

/** 数字输入框的 v-model 可能是 number（Vue 会自动转换），统一按字符串解析 */
const parseYuan = (v: string | number) => {
  const s = String(v ?? '').trim();
  const n = yuanToFen(s);
  return s && Number.isFinite(n) ? n : undefined;
};

function reset() {
  draft.value = { ...emptyFilter(), q: props.filter.q, sort: props.filter.sort };
  min.value = max.value = '';
}

function confirm() {
  const f = { ...draft.value, minFen: parseYuan(min.value), maxFen: parseYuan(max.value) };
  if (f.minFen !== undefined && f.maxFen !== undefined && f.minFen > f.maxFen) [f.minFen, f.maxFen] = [f.maxFen, f.minFen];
  if (f.range !== 'custom') {
    f.from = undefined;
    f.to = undefined;
  }
  emit('apply', f);
  show.value = false;
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round closeable teleport="body" class="popup">
    <div class="panel">
      <div class="title">筛选</div>

      <div class="section">时间</div>
      <div class="chips">
        <span v-for="r in RANGES" :key="r.key" class="chip" :class="{ on: draft.range === r.key }" @click="draft.range = r.key">
          {{ r.label }}
        </span>
      </div>
      <div v-if="draft.range === 'custom'" class="dates">
        <input v-model="draft.from" type="date" class="input" />
        <span class="muted">至</span>
        <input v-model="draft.to" type="date" class="input" />
      </div>

      <div class="section">收支</div>
      <div class="chips">
        <span class="chip" :class="{ on: !draft.type }" @click="setType(undefined)">全部</span>
        <span class="chip" :class="{ on: draft.type === 'expense' }" @click="setType('expense')">支出</span>
        <span class="chip" :class="{ on: draft.type === 'income' }" @click="setType('income')">收入</span>
      </div>

      <template v-for="g in groups" :key="g.type">
        <div class="section">{{ g.label }} <span class="muted hint">可多选，选中后可细分</span></div>
        <div class="chips">
          <span v-for="t in g.tops" :key="t.id" class="chip" :class="{ on: topActive(t) }" @click="toggleTop(t)">
            {{ t.icon }} {{ t.name }}
          </span>
        </div>
        <template v-for="t in g.tops" :key="'sub-' + t.id">
          <div v-if="topActive(t) && kids(t).length" class="chips sub">
            <span class="muted sub-label">{{ t.name }}：</span>
            <span class="chip small" :class="{ on: sel.has(t.id) }" @click="selectWhole(t)">全部</span>
            <span v-for="s in kids(t)" :key="s.id" class="chip small" :class="{ on: sel.has(s.id) }" @click="toggleSub(t, s)">
              {{ s.name }}
            </span>
          </div>
        </template>
      </template>

      <div class="section">金额（元）</div>
      <div class="dates">
        <input v-model="min" type="number" inputmode="decimal" min="0" placeholder="最低" class="input" />
        <span class="muted">~</span>
        <input v-model="max" type="number" inputmode="decimal" min="0" placeholder="最高" class="input" />
      </div>

      <div class="section">来源</div>
      <div class="chips">
        <span v-for="s in SOURCES" :key="s.key" class="chip" :class="{ on: draft.sources.includes(s.key) }" @click="toggleSource(s.key)">
          {{ s.label }}
        </span>
      </div>

      <div class="actions">
        <van-button round plain class="btn" @click="reset">重置</van-button>
        <van-button round type="primary" class="btn" @click="confirm">确定</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.popup {
  max-height: 88vh;
}
.panel {
  padding: 16px 16px calc(16px + var(--safe-bottom));
}
.title {
  text-align: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.section {
  font-size: 13px;
  font-weight: 600;
  margin: 14px 0 8px;
}
.hint {
  font-weight: normal;
  font-size: 12px;
  margin-left: 4px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chips.sub {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg);
  border-radius: 8px;
  align-items: center;
}
.sub-label {
  font-size: 12px;
}
.chip {
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
  background: var(--bg);
  border: 1px solid transparent;
  cursor: pointer;
}
.chips.sub .chip {
  background: var(--card);
}
.chip.small {
  padding: 4px 10px;
  font-size: 12px;
}
.chip.on {
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}
.dates {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.input {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}
.btn {
  flex: 1;
}
</style>
