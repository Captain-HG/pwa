<script setup lang="ts">
import dayjs from 'dayjs';
import { showConfirmDialog, showToast } from 'vant';
import { useRouter } from 'vue-router';
import CategoryIcon from './CategoryIcon.vue';
import { formatFen } from '@/domain/money';
import type { Category, Transaction } from '@/domain/types';
import { removeTx } from '@/services/transactions';
import { can } from '@/stores/auth';

/** 单条流水：点击进入详情；有记账权限时可左滑删除。showDate 用于平铺列表（按金额排序） */
const props = defineProps<{ tx: Transaction; getCategory: (id?: string) => Category; showDate?: boolean }>();

const router = useRouter();
const canEdit = () => can('ledger.edit');

async function onDelete() {
  try {
    await showConfirmDialog({ title: '删除这笔记录？', confirmButtonText: '删除', confirmButtonColor: '#ee0a24' });
  } catch {
    return;
  }
  await removeTx(props.tx.id);
  showToast('已删除');
}
</script>

<template>
  <van-swipe-cell :disabled="!canEdit()">
    <div class="tx" @click="router.push(`/tx/${tx.id}`)">
      <CategoryIcon :icon="getCategory(tx.categoryId).icon" :color="getCategory(tx.categoryId).color" />
      <div class="tx-main">
        <div class="tx-title">{{ getCategory(tx.categoryId).name }}</div>
        <div v-if="tx.note || showDate" class="tx-note muted">
          <span v-if="showDate" class="num">{{ dayjs(tx.occurredAt).format('MM-DD HH:mm') }}</span>
          <span v-if="showDate && tx.note"> · </span>
          <span v-if="tx.note">{{ tx.note }}</span>
        </div>
      </div>
      <div class="tx-amount num" :class="tx.type">
        {{ tx.type === 'income' ? '+' : '-' }}{{ formatFen(tx.amount) }}
      </div>
    </div>
    <template #right>
      <van-button square type="danger" text="删除" class="del-btn" @click="onDelete" />
    </template>
  </van-swipe-cell>
</template>

<style scoped>
.tx {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--card);
  cursor: pointer;
}
.tx-main {
  flex: 1;
  min-width: 0;
}
.tx-title {
  font-size: 15px;
}
.tx-note {
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx-amount {
  font-size: 16px;
  font-weight: 600;
}
.tx-amount.expense {
  color: var(--text);
}
.del-btn {
  height: 100%;
}
</style>
