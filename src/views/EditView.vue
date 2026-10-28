<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import AmountKeypad from '@/components/AmountKeypad.vue';
import CategorySelect from '@/components/CategorySelect.vue';
import { topLevel } from '@/domain/category';
import { useCategories } from '@/composables/useCategories';
import { useGoBack } from '@/composables/useGoBack';
import { evalExpression, fenToInput, formatFen, hasOperator } from '@/domain/money';
import type { CategoryType } from '@/domain/types';
import { addTx, getTx, removeTx, updateTx } from '@/services/transactions';

const INPUT_FMT = 'YYYY-MM-DDTHH:mm';

const route = useRoute();
const router = useRouter();
const goBack = useGoBack();
const id = computed(() => route.params.id as string | undefined);

const type = ref<CategoryType>(route.query.type === 'income' ? 'income' : 'expense');
const categoryId = ref('');
const expr = ref('');
const note = ref('');
// 交易对方、商品（导入记录自带，手动记账也可以填写）
const counterparty = ref('');
const goods = ref('');
const showMore = ref(false);
/** 编辑前的自动备注（「交易对方 · 商品」），用于修改商品时同步更新备注 */
let autoNote = '';
const joinNote = (a: string, b: string) => [...new Set([a.trim(), b.trim()].filter(Boolean))].join(' · ');
const when = ref(dayjs().format(INPUT_FMT));

const { all } = useCategories();
// 当前类型的全部分类（隐藏的由 CategorySelect 处理：不显示，但编辑旧流水时仍显示其当前分类）
const ofType = computed(() => all.value.filter((c) => c.type === type.value));

watch([type, ofType], () => {
  if (ofType.value.length && !ofType.value.some((c) => c.id === categoryId.value)) {
    categoryId.value = topLevel(ofType.value.filter((c) => !c.hidden))[0]?.id ?? '';
  }
});

onMounted(async () => {
  if (!id.value) return;
  const tx = await getTx(id.value);
  if (!tx || tx.type === 'transfer') {
    showToast('记录不存在');
    goBack();
    return;
  }
  type.value = tx.type;
  categoryId.value = tx.categoryId ?? '';
  expr.value = fenToInput(tx.amount);
  note.value = tx.note ?? '';
  counterparty.value = tx.meta?.counterparty ?? '';
  goods.value = tx.meta?.goods ?? '';
  showMore.value = !!(counterparty.value || goods.value);
  autoNote = joinNote(counterparty.value, goods.value);
  when.value = dayjs(tx.occurredAt).format(INPUT_FMT);
});

const dateLabel = computed(() => {
  const d = dayjs(when.value);
  if (!d.isValid()) return '选择日期';
  return d.isSame(dayjs(), 'day') ? '今天 ' + d.format('HH:mm') : d.format('M月D日 HH:mm');
});

const preview = computed(() => {
  const fen = evalExpression(expr.value);
  return Number.isNaN(fen) ? '--' : formatFen(fen);
});

function openPicker(e: Event) {
  (e.target as HTMLInputElement).showPicker?.();
}

async function save() {
  const amount = evalExpression(expr.value);
  if (!(amount > 0)) return showToast('请输入金额');
  if (!categoryId.value) return showToast('请选择分类');
  const d = dayjs(when.value);
  // 备注仍是导入时自动生成的那一份（完整，或被截断为 50 字）时，跟随新的交易对方 / 商品更新
  const refundPrefix = note.value.startsWith('退款 · ') ? '退款 · ' : '';
  const core = note.value.slice(refundPrefix.length).replace(/（已退款 ¥[\d.,]+）$/, '');
  const isAuto = !!autoNote && (core === autoNote || (core.length >= 40 && autoNote.startsWith(core)));
  const nextAuto = joinNote(counterparty.value, goods.value);
  const nextNote = isAuto && nextAuto !== autoNote ? (refundPrefix + nextAuto).slice(0, 50) : note.value;
  const input = {
    type: type.value,
    amount,
    categoryId: categoryId.value,
    occurredAt: (d.isValid() ? d : dayjs()).valueOf(),
    note: nextNote,
    counterparty: counterparty.value,
    goods: goods.value,
  };
  try {
    if (id.value) await updateTx(id.value, input);
    else await addTx(input);
  } catch (e) {
    return showToast((e as Error).message);
  }
  showToast('已保存');
  goBack();
}

async function onDelete() {
  if (!id.value) return;
  try {
    await showConfirmDialog({ title: '删除这笔记录？', confirmButtonText: '删除', confirmButtonColor: '#ee0a24' });
  } catch {
    return;
  }
  await removeTx(id.value);
  showToast('已删除');
  goBack();
}
</script>

<template>
  <div class="edit-page">
    <header class="head">
      <span class="link" @click="goBack">取消</span>
      <div class="seg">
        <button :class="{ on: type === 'expense' }" @click="type = 'expense'">支出</button>
        <button :class="{ on: type === 'income' }" @click="type = 'income'">收入</button>
      </div>
      <span class="link danger" :style="{ visibility: id ? 'visible' : 'hidden' }" @click="onDelete">删除</span>
    </header>

    <div class="cats">
      <CategorySelect v-model="categoryId" :categories="ofType" manage @manage="router.push('/categories')" />
    </div>

    <div class="panel">
      <div class="meta">
        <input v-model="note" class="note" placeholder="添加备注" maxlength="50" />
        <label class="date">
          <van-icon name="clock-o" />
          <span>{{ dateLabel }}</span>
          <input v-model="when" type="datetime-local" class="date-input" @click="openPicker" />
        </label>
      </div>
      <div v-if="showMore" class="meta">
        <input v-model="counterparty" class="note" placeholder="交易对方" maxlength="100" />
        <input v-model="goods" class="note" placeholder="商品" maxlength="100" />
      </div>
      <div v-else class="more" @click="showMore = true">＋ 交易对方 / 商品</div>
      <div class="amount num" :class="type">
        <span class="cur">¥</span>
        <span class="expr">{{ expr || '0.00' }}</span>
      </div>
      <div class="preview num muted">{{ hasOperator(expr) ? '= ' + preview : '' }}</div>
      <AmountKeypad v-model="expr" @done="save" />
    </div>
  </div>
</template>

<style scoped>
.edit-page {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top);
  background: var(--card);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
}
.link {
  font-size: 15px;
  color: var(--primary);
  cursor: pointer;
  min-width: 40px;
}
.link.danger {
  color: var(--expense);
  text-align: right;
}
.cats {
  flex: 1;
  overflow-y: auto;
}
.panel {
  border-top: 1px solid var(--border);
}
.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px 0;
}
.note {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 14px;
}
.date {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-2);
  background: var(--bg);
  border-radius: 6px;
  padding: 7px 10px;
  white-space: nowrap;
  cursor: pointer;
}
.date-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.more {
  font-size: 12px;
  color: var(--primary);
  padding: 6px 16px 0;
  cursor: pointer;
}
.amount {
  text-align: right;
  padding: 8px 16px 0;
  font-size: 34px;
  font-weight: 700;
  word-break: break-all;
}
.amount.expense {
  color: var(--text);
}
.cur {
  font-size: 20px;
  margin-right: 4px;
}
.preview {
  text-align: right;
  padding: 0 16px 6px;
  font-size: 14px;
  min-height: 20px;
}
</style>
