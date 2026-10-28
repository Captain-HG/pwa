<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import CategoryIcon from '@/components/CategoryIcon.vue';
import CategorySelect from '@/components/CategorySelect.vue';
import { useCategories } from '@/composables/useCategories';
import { useGoBack } from '@/composables/useGoBack';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { db } from '@/db/schema';
import { formatFen } from '@/domain/money';
import type { Transaction } from '@/domain/types';
import { removeTx } from '@/services/transactions';
import { can } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const goBack = useGoBack();
const id = computed(() => String(route.params.id));
const { all, get, nameOf } = useCategories();

const tx = useLiveQuery(() => db.transactions.get(id.value), id, undefined as Transaction | undefined);
const loaded = ref(false);
watch(tx, () => (loaded.value = true));

const cat = computed(() => get(tx.value?.categoryId));
const canEdit = computed(() => can('ledger.edit'));

const SOURCE: Record<string, string> = { wechat: '微信支付（导入）', alipay: '支付宝（导入）' };

function isAutoNote(note = '', counterparty = '', goods = ''): boolean {
  const auto = [...new Set([counterparty, goods].filter(Boolean))].join(' · ');
  return !note || note.replace(/^退款 · /, '').replace(/（已退款 ¥[\d.,]+）$/, '') === auto.slice(0, note.length);
}

/** 参照微信支付账单详情的字段顺序，没有值的行不显示 */
const rows = computed(() => {
  const t = tx.value;
  if (!t) return [];
  const m = t.meta ?? {};
  const list: { label: string; value?: string; copy?: boolean }[] = [
    { label: '当前状态', value: m.status },
    { label: t.type === 'income' ? '到账时间' : '支付时间', value: dayjs(t.occurredAt).format('YYYY-MM-DD HH:mm:ss') },
    { label: '交易对方', value: m.counterparty },
    { label: '商品', value: m.goods },
    { label: t.type === 'income' ? '收款方式' : '支付方式', value: m.method },
    { label: '交易类型', value: m.billType },
    { label: '交易单号', value: t.sourceOrderNo, copy: true },
    { label: '商户单号', value: m.merchantOrderNo, copy: true },
    { label: '账单来源', value: t.source ? SOURCE[t.source] : '手动记账' },
    // 导入记录的默认备注就是「交易对方 · 商品」，与上面重复时不显示
    { label: '备注', value: t.meta && isAutoNote(t.note, m.counterparty, m.goods) ? undefined : t.note },
    { label: '记录时间', value: dayjs(t.createdAt).format('YYYY-MM-DD HH:mm') },
  ];
  return list.filter((r) => r.value);
});

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch {
    showToast('复制失败，请长按选中复制');
  }
}

// ---------- 修改分类 ----------
const showCat = ref(false);
const pick = ref('');
const ofType = computed(() => all.value.filter((c) => c.type === tx.value?.type));

function openCat() {
  if (!canEdit.value || !tx.value) return;
  pick.value = tx.value.categoryId ?? '';
  showCat.value = true;
}

async function saveCat() {
  if (!tx.value || !pick.value) return;
  await db.transactions.update(tx.value.id, { categoryId: pick.value });
  showCat.value = false;
  showToast('已修改分类');
}

async function onDelete() {
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
  <div class="page">
    <van-nav-bar title="账单详情" left-arrow @click-left="goBack" />

    <van-empty v-if="loaded && (!tx || tx.deleted)" description="记录不存在或已删除" />

    <template v-else-if="tx">
      <div class="card head">
        <CategoryIcon :icon="cat.icon" :color="cat.color" :size="52" />
        <div class="cat-name">{{ nameOf(tx.categoryId) }}</div>
        <div class="amount num" :class="tx.type">{{ tx.type === 'income' ? '+' : '-' }}{{ formatFen(tx.amount) }}</div>
        <div v-if="tx.meta?.refundedFen" class="refund muted num">
          原支付 ¥{{ formatFen(tx.amount + tx.meta.refundedFen) }}，已退款 ¥{{ formatFen(tx.meta.refundedFen) }}
        </div>
      </div>

      <div class="card">
        <div v-for="r in rows" :key="r.label" class="row">
          <span class="label">{{ r.label }}</span>
          <span class="value" :class="{ mono: r.copy }">{{ r.value }}</span>
          <span v-if="r.copy" class="copy" @click="copy(r.value!)">复制</span>
        </div>
        <div class="row" :class="{ clickable: canEdit }" @click="openCat">
          <span class="label">分类</span>
          <span class="value">{{ nameOf(tx.categoryId) }}</span>
          <van-icon v-if="canEdit" name="arrow" class="arrow" />
        </div>
      </div>

      <div v-if="canEdit" class="actions">
        <van-button round block type="primary" @click="router.push(`/edit/${tx.id}`)">编辑</van-button>
        <van-button round block plain type="danger" @click="onDelete">删除</van-button>
      </div>
    </template>

    <van-popup v-model:show="showCat" position="bottom" round closeable teleport="body">
      <div class="sheet">
        <div class="sheet-title">修改分类</div>
        <CategorySelect v-model="pick" :categories="ofType" />
        <div class="sheet-actions">
          <van-button round block type="primary" @click="saveCat">确定</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 20px;
  gap: 6px;
}
.cat-name {
  font-size: 15px;
  color: var(--text-2);
}
.amount {
  font-size: 36px;
  font-weight: 700;
}
.amount.expense {
  color: var(--text);
}
.refund {
  font-size: 12px;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.row:last-child {
  border-bottom: 0;
}
.row.clickable {
  cursor: pointer;
}
.label {
  width: 72px;
  flex-shrink: 0;
  color: var(--text-2);
}
.value {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  line-height: 1.5;
}
.mono {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.copy {
  color: var(--primary);
  font-size: 13px;
  flex-shrink: 0;
  cursor: pointer;
}
.arrow {
  color: var(--text-2);
  align-self: center;
}
.actions {
  display: flex;
  gap: 12px;
  padding: 8px 16px calc(24px + var(--safe-bottom));
}
.sheet {
  padding: 16px 0 calc(16px + var(--safe-bottom));
}
.sheet-title {
  text-align: center;
  font-weight: 600;
}
.sheet-actions {
  padding: 8px 16px 0;
}
</style>
