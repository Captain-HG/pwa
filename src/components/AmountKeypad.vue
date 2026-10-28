<script setup lang="ts">
import { computed } from 'vue';
import { showToast } from 'vant';
import { applyKey, type KeypadKey } from '@/domain/keypad';
import { evalExpression, fenToInput, hasOperator } from '@/domain/money';

const expr = defineModel<string>({ required: true });
const emit = defineEmits<{ done: [] }>();

const KEYS: (KeypadKey | 'done')[] = ['1', '2', '3', 'del', '4', '5', '6', '+', '7', '8', '9', '-', '.', '0', '00', 'done'];

const pending = computed(() => hasOperator(expr.value));

function press(key: KeypadKey | 'done') {
  if (key !== 'done') {
    expr.value = applyKey(expr.value, key);
    return;
  }
  if (!pending.value) {
    emit('done');
    return;
  }
  // 有算式时先求值，再次点击才保存
  const fen = evalExpression(expr.value);
  if (fen > 0) expr.value = fenToInput(fen);
  else showToast('结果需大于 0');
}
</script>

<template>
  <div class="keypad">
    <button
      v-for="k in KEYS"
      :key="k"
      class="key"
      :class="{ done: k === 'done', op: k === '+' || k === '-' || k === 'del' }"
      @click="press(k)"
    >
      <van-icon v-if="k === 'del'" name="revoke" size="22" />
      <template v-else-if="k === 'done'">{{ pending ? '=' : '完成' }}</template>
      <template v-else>{{ k }}</template>
    </button>
  </div>
</template>

<style scoped>
.keypad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 6px 6px calc(6px + var(--safe-bottom));
  background: var(--bg);
}
.key {
  height: 52px;
  border: 0;
  border-radius: 8px;
  background: var(--card);
  color: var(--text);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  user-select: none;
}
.key:active {
  filter: brightness(0.9);
}
.key.op {
  font-size: 20px;
  color: var(--text-2);
}
.key.done {
  background: var(--primary);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}
</style>
