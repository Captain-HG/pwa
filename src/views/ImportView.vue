<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, ref, shallowRef } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import { useRouter } from 'vue-router';
import CategoryIcon from '@/components/CategoryIcon.vue';
import { useCategories } from '@/composables/useCategories';
import { useGoBack } from '@/composables/useGoBack';
import { formatFen } from '@/domain/money';
import type { PlanItem } from '@/import/plan';
import { SOURCE_NAME } from '@/import/types';
import { applyImport, groupKey, prepareImport, type PreparedImport } from '@/services/billImport';
import { summarize } from '@/import/plan';
import { childrenOf, topLevel } from '@/domain/category';
import { syncNow } from '@/sync/sync';

const goBack = useGoBack();
const router = useRouter();
const { all: allCategories, get: getCategory, nameOf } = useCategories();

const fileInput = ref<HTMLInputElement>();
const loading = ref(false);
const saving = ref(false);
// 导入计划只读展示，用浅层响应避免把记录包成代理
const prepared = shallowRef<PreparedImport | null>(null);
const include = ref(new Set<string>());
const overrides = ref(new Map<string, string>());
const showHelp = ref(false);
const openPanels = ref<string[]>([]);

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  loading.value = true;
  try {
    const p = await prepareImport(file);
    prepared.value = p;
    // 默认：新增全部导入（含找不到原交易的退款），疑似重复不导入
    include.value = new Set(p.items.filter((i) => i.kind === 'new').map((i) => i.id));
    overrides.value = new Map();
  } catch (err) {
    showToast((err as Error).message || '无法读取该文件');
  } finally {
    loading.value = false;
  }
}

const items = computed(() => prepared.value?.items ?? []);
const byKind = (k: PlanItem['kind']) => items.value.filter((i) => i.kind === k);
const newItems = computed(() => byKind('new').filter((i) => !i.row.refund));
const refunds = computed(() => byKind('new').filter((i) => i.row.refund));
const suspects = computed(() => byKind('suspect'));
const updates = computed(() => byKind('update'));
const exists = computed(() => byKind('exists'));
const skips = computed(() => byKind('skip'));
const deleted = computed(() => byKind('deleted'));
const allRestore = computed(() => deleted.value.length > 0 && deleted.value.every((i) => include.value.has(i.id)));

function toggleAllRestore(on: boolean) {
  const next = new Set(include.value);
  for (const i of deleted.value) on ? next.add(i.id) : next.delete(i.id);
  include.value = next;
}

const period = computed(() => {
  const b = prepared.value?.bill;
  if (!b?.start) return '';
  return `${dayjs(b.start).format('YYYY-MM-DD')} 至 ${dayjs(b.end).format('YYYY-MM-DD')}`;
});

const skipReasons = computed(() => {
  const m = new Map<string, number>();
  for (const i of [...skips.value, ...exists.value]) m.set(i.reason!, (m.get(i.reason!) ?? 0) + 1);
  return [...m.entries()];
});

/** 新增记录按交易对方分组，便于批量改分类 */
interface Group {
  key: string;
  type: 'expense' | 'income';
  items: PlanItem[];
  total: number;
}
const groups = computed<Group[]>(() => {
  const map = new Map<string, Group>();
  for (const it of newItems.value) {
    const key = groupKey(it);
    const type = it.tx.type === 'income' ? 'income' : 'expense';
    const id = `${type}:${key}`;
    const g = map.get(id) ?? { key, type, items: [], total: 0 };
    g.items.push(it);
    g.total += it.tx.amount;
    map.set(id, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
});

const categoryOf = (g: Group) => overrides.value.get(g.key) ?? g.items[0].tx.categoryId!;
/** 一级分类后紧跟其子分类，显示全名 */
const optionsFor = (type: string) => {
  const list = allCategories.value.filter((c) => c.type === type && !c.hidden);
  return topLevel(list).flatMap((t) => [t, ...childrenOf(t.id, list)]);
};
const enrich = computed(() => summarize(items.value).enrich);

function setCategory(g: Group, id: string) {
  const next = new Map(overrides.value);
  if (id === g.items[0].tx.categoryId) next.delete(g.key);
  else next.set(g.key, id);
  overrides.value = next;
}

function toggle(id: string, on: boolean) {
  const next = new Set(include.value);
  if (on) next.add(id);
  else next.delete(id);
  include.value = next;
}

const writeCount = computed(
  () =>
    [...newItems.value, ...refunds.value, ...suspects.value, ...deleted.value].filter((i) => include.value.has(i.id)).length +
    updates.value.length +
    enrich.value.meta,
);
const newTotals = computed(() => {
  let expense = 0;
  let income = 0;
  for (const i of [...newItems.value, ...refunds.value, ...suspects.value, ...deleted.value]) {
    if (!include.value.has(i.id)) continue;
    if (i.tx.type === 'income') income += i.tx.amount;
    else expense += i.tx.amount;
  }
  return { expense, income };
});

const fmtTime = (t: number) => dayjs(t).format('MM-DD HH:mm');
const sign = (i: PlanItem) => (i.tx.type === 'income' ? '+' : '-');

async function confirmImport() {
  if (!writeCount.value) return showToast('没有需要导入的记录');
  try {
    await showConfirmDialog({
      title: '确认导入',
      message: `将写入 ${writeCount.value} 条记录${overrides.value.size ? `，并保存 ${overrides.value.size} 条分类规则` : ''}。`,
    });
  } catch {
    return;
  }
  saving.value = true;
  try {
    const r = await applyImport(items.value, { include: include.value, overrides: overrides.value });
    const parts = [`新增 ${r.added} 条`];
    if (r.restored) parts.push(`恢复 ${r.restored} 条`);
    if (r.enriched) parts.push(`补全 ${r.enriched} 条`);
    if (r.updated) parts.push(`更新 ${r.updated} 条`);
    if (r.removed) parts.push(`删除 ${r.removed} 条`);
    showToast(`导入完成：${parts.join('，')}`);
    void syncNow();
    prepared.value = null;
    router.replace('/');
  } catch (err) {
    showToast('导入失败：' + (err as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="导入账单" left-arrow @click-left="goBack" />
    <input ref="fileInput" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="onFile" />

    <!-- 选择文件 -->
    <template v-if="!prepared">
      <div class="card intro">
        <van-icon name="description-o" size="40" color="#1989fa" />
        <div class="intro-title">导入支付宝 / 微信账单</div>
        <div class="muted small">支持支付宝 CSV、微信 Excel。文件只在本机解析，不会上传。</div>
        <van-button type="primary" round block :loading="loading" class="pick" @click="fileInput?.click()">选择账单文件</van-button>
        <div class="link" @click="showHelp = !showHelp">如何导出账单？</div>
      </div>
      <div v-if="showHelp" class="card help">
        <p><b>支付宝</b>：我的 → 账单 → 右上角「…」→ 开具交易流水证明 → 用于个人对账 → 填写邮箱。</p>
        <p><b>微信</b>：我 → 服务 → 钱包 → 账单 → 右上角「…」→ 下载账单 → 用于个人对账 → 填写邮箱。</p>
        <p class="muted">邮件里是加密压缩包，解压密码在对应 App 里收到。解压后选择其中的 CSV / Excel 文件。重复导入不会产生重复记录。</p>
      </div>
    </template>

    <!-- 预览 -->
    <template v-else>
      <div class="card summary">
        <div class="summary-title">{{ SOURCE_NAME[prepared.bill.source] }} · {{ period }}</div>
        <div class="muted small">共 {{ prepared.bill.rows.length }} 条</div>
        <div class="stats">
          <div><b>{{ newItems.length + refunds.length }}</b><span>新增</span></div>
          <div><b>{{ updates.length }}</b><span>金额更新</span></div>
          <div><b>{{ suspects.length }}</b><span>疑似重复</span></div>
          <div><b>{{ exists.length + skips.length + deleted.filter((i) => !include.has(i.id)).length }}</b><span>不导入</span></div>
        </div>
        <div v-if="deleted.length" class="muted small totals">
          之前删除过 {{ deleted.length }} 条（默认不恢复，可在下方勾选）
        </div>
        <div v-if="enrich.meta" class="muted small totals">
          补全已导入记录的详情 {{ enrich.meta }} 条{{ enrich.category ? `，其中细化分类 ${enrich.category} 条` : '' }}
        </div>
        <div class="muted small totals num">
          将导入：支出 ¥{{ formatFen(newTotals.expense) }} · 收入 ¥{{ formatFen(newTotals.income) }}
        </div>
      </div>

      <van-collapse v-model="openPanels" class="panels">
        <van-collapse-item v-if="groups.length" name="groups" :title="`按交易对方调整分类（${groups.length} 组）`">
          <div class="hint muted">修改后会保存为规则，以后导入自动使用。</div>
          <div v-for="g in groups" :key="g.type + g.key" class="group">
            <CategoryIcon :icon="getCategory(categoryOf(g)).icon" :color="getCategory(categoryOf(g)).color" :size="30" />
            <div class="group-main">
              <div class="ellipsis">{{ g.key }}</div>
              <div class="muted small num">{{ g.items.length }} 笔 · {{ g.type === 'income' ? '+' : '-' }}¥{{ formatFen(g.total) }}</div>
            </div>
            <select class="cat-select" :value="categoryOf(g)" @change="setCategory(g, ($event.target as HTMLSelectElement).value)">
              <option v-for="c in optionsFor(g.type)" :key="c.id" :value="c.id">{{ nameOf(c.id) }}</option>
            </select>
          </div>
        </van-collapse-item>

        <van-collapse-item v-if="refunds.length" name="refunds" :title="`退款记为收入（${refunds.length} 条）`">
          <div class="hint muted">在本文件中找不到原交易的退款（原交易在更早的账单里），默认记为收入。</div>
          <van-cell v-for="i in refunds" :key="i.id" :title="i.tx.note" :label="fmtTime(i.tx.occurredAt)" center>
            <template #right-icon>
              <span class="num amount">+{{ formatFen(i.tx.amount) }}</span>
              <van-checkbox :model-value="include.has(i.id)" @update:model-value="toggle(i.id, $event)" />
            </template>
          </van-cell>
        </van-collapse-item>

        <van-collapse-item v-if="suspects.length" name="suspects" :title="`疑似与手动记录重复（${suspects.length} 条，默认不导入）`">
          <van-cell v-for="i in suspects" :key="i.id" center>
            <template #title>
              <div class="ellipsis">{{ i.tx.note }}</div>
              <div class="muted small">账单 {{ fmtTime(i.tx.occurredAt) }} · 手动 {{ fmtTime(i.manual!.occurredAt) }}{{ i.manual!.note ? ' · ' + i.manual!.note : '' }}</div>
            </template>
            <template #right-icon>
              <span class="num amount">{{ sign(i) }}{{ formatFen(i.tx.amount) }}</span>
              <van-checkbox :model-value="include.has(i.id)" @update:model-value="toggle(i.id, $event)" />
            </template>
          </van-cell>
        </van-collapse-item>

        <van-collapse-item v-if="deleted.length" name="deleted" :title="`之前删除过的记录（${deleted.length} 条）`">
          <van-cell title="全部恢复" center>
            <template #right-icon>
              <van-switch :model-value="allRestore" size="20px" @update:model-value="toggleAllRestore" />
            </template>
          </van-cell>
          <van-cell v-for="i in deleted" :key="i.id" :title="i.tx.note" :label="fmtTime(i.tx.occurredAt)" center>
            <template #right-icon>
              <span class="num amount">{{ sign(i) }}{{ formatFen(i.tx.amount) }}</span>
              <van-checkbox :model-value="include.has(i.id)" @update:model-value="toggle(i.id, $event)" />
            </template>
          </van-cell>
        </van-collapse-item>

        <van-collapse-item v-if="updates.length" name="updates" :title="`金额更新（${updates.length} 条）`">
          <div class="hint muted">之前导入后发生了退款，按最新的实际金额更新。</div>
          <van-cell v-for="i in updates" :key="i.id" :title="i.tx.note" :label="fmtTime(i.tx.occurredAt)" :value="i.reason" />
        </van-collapse-item>

        <van-collapse-item v-if="skipReasons.length" name="skips" :title="`不导入（${exists.length + skips.length} 条）`">
          <van-cell v-for="[reason, n] in skipReasons" :key="reason" :title="reason" :value="`${n} 条`" />
        </van-collapse-item>
      </van-collapse>

      <div class="actions">
        <van-button type="primary" round block :loading="saving" :disabled="!writeCount" @click="confirmImport">
          确认写入 {{ writeCount }} 条
        </van-button>
        <van-button round block plain @click="prepared = null">重新选择文件</van-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px 20px;
  text-align: center;
}
.intro-title {
  font-size: 17px;
  font-weight: 600;
}
.pick {
  margin-top: 12px;
}
.link {
  color: var(--primary);
  font-size: 13px;
  margin-top: 6px;
  cursor: pointer;
}
.help {
  padding: 4px 16px;
  font-size: 13px;
  line-height: 1.7;
}
.small {
  font-size: 12px;
}
.summary {
  padding: 16px;
}
.summary-title {
  font-weight: 600;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  text-align: center;
  margin: 14px 0 10px;
}
.stats b {
  display: block;
  font-size: 20px;
}
.stats span {
  font-size: 12px;
  color: var(--text-2);
}
.totals {
  text-align: center;
}
.panels {
  margin: 0 12px;
  border-radius: 12px;
  overflow: hidden;
}
.hint {
  font-size: 12px;
  padding-bottom: 6px;
}
.group {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.group-main {
  flex: 1;
  min-width: 0;
  font-size: 14px;
}
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cat-select {
  font-size: 14px;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}
.amount {
  margin-right: 10px;
  font-weight: 600;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px calc(24px + var(--safe-bottom));
}
</style>
