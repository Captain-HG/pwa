<script setup lang="ts">
import { computed } from 'vue';
import CategoryIcon from './CategoryIcon.vue';
import { childrenOf, rootId, topLevel } from '@/domain/category';
import type { Category } from '@/domain/types';

/**
 * 两级分类选择：宫格选一级分类，有子分类时下方出现子分类标签（可选「不细分」）。
 * categories 传入同一类型（支出 / 收入）的全部分类。
 */
const props = withDefaults(defineProps<{ categories: Category[]; manage?: boolean }>(), { manage: false });
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ manage: [] }>();

const map = computed(() => new Map(props.categories.map((c) => [c.id, c])));
const selectedRoot = computed(() => rootId(model.value, map.value) ?? '');
// 隐藏的分类不显示，但当前选中的仍然显示
const visible = computed(() =>
  props.categories.filter((c) => !c.hidden || c.id === model.value || c.id === selectedRoot.value),
);
const tops = computed(() => topLevel(visible.value));
const subs = computed(() => (selectedRoot.value ? childrenOf(selectedRoot.value, visible.value) : []));
</script>

<template>
  <div>
    <div class="grid">
      <div
        v-for="c in tops"
        :key="c.id"
        class="item"
        :class="{ active: c.id === selectedRoot }"
        @click="model = c.id"
      >
        <CategoryIcon :icon="c.icon" :color="c.color" :size="46" :active="c.id === selectedRoot" />
        <span>{{ c.name }}</span>
      </div>
      <div v-if="props.manage" class="item" @click="emit('manage')">
        <span class="manage"><van-icon name="setting-o" size="20" /></span>
        <span>管理</span>
      </div>
    </div>
    <div v-if="subs.length" class="subs">
      <span class="chip" :class="{ on: model === selectedRoot }" @click="model = selectedRoot">不细分</span>
      <span v-for="s in subs" :key="s.id" class="chip" :class="{ on: model === s.id }" @click="model = s.id">
        {{ s.icon }} {{ s.name }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  row-gap: 14px;
  padding: 16px 8px 10px;
}
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  text-align: center;
}
.item.active {
  color: var(--text);
  font-weight: 600;
}
.manage {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--text-2);
}
.subs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 12px 10px;
  scrollbar-width: none;
}
.chip {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  border: 1px solid transparent;
}
.chip.on {
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}
</style>
