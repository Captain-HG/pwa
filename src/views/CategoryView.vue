<script setup lang="ts">
import { computed, ref } from 'vue';
import { showToast } from 'vant';
import CategoryIcon from '@/components/CategoryIcon.vue';
import { useCategories } from '@/composables/useCategories';
import { childrenOf, topLevel } from '@/domain/category';
import { useGoBack } from '@/composables/useGoBack';
import type { Category, CategoryType } from '@/domain/types';
import { createCategory, moveCategory, updateCategory } from '@/services/categories';

const EMOJIS = [
  '🍜', '🍔', '☕', '🍰', '🍎', '🍺', '🛒', '🛍️', '👕', '💄',
  '🚇', '🚕', '⛽', '🚗', '✈️', '🏠', '💡', '💧', '📱', '💻',
  '🎮', '🎬', '🎵', '⚽', '🏋️', '💊', '🏥', '📚', '🎓', '✏️',
  '🎁', '🧧', '❤️', '👶', '🐱', '🐶', '💰', '🏆', '📈', '💳',
  '🏦', '🔧', '✂️', '🧾', '📦', '🎉', '🌱', '🧸', '🚬', '⭐',
];

const goBack = useGoBack();
const type = ref<CategoryType>('expense');
const { all } = useCategories();
const ofType = computed(() => all.value.filter((c) => c.type === type.value));
const tops = computed(() => topLevel(ofType.value));

/** 一级分类后紧跟其子分类；first / last 用于同级排序按钮 */
const list = computed(() =>
  tops.value.flatMap((t, ti) => {
    const kids = childrenOf(t.id, ofType.value);
    return [
      { c: t, sub: false, first: ti === 0, last: ti === tops.value.length - 1 },
      ...kids.map((k, ki) => ({ c: k, sub: true, first: ki === 0, last: ki === kids.length - 1 })),
    ];
  }),
);

const show = ref(false);
const editing = ref<Category | null>(null);
const form = ref({ name: '', icon: EMOJIS[0], parentId: '' });

function openCreate(parentId = '') {
  editing.value = null;
  form.value = { name: '', icon: EMOJIS[0], parentId };
  show.value = true;
}

function openEdit(c: Category) {
  editing.value = c;
  form.value = { name: c.name, icon: c.icon, parentId: c.parentId ?? '' };
  show.value = true;
}

async function beforeClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  try {
    const { name, icon, parentId } = form.value;
    if (editing.value) await updateCategory(editing.value.id, { name, icon });
    else await createCategory({ type: type.value, name, icon, parentId: parentId || undefined });
    return true;
  } catch (e) {
    showToast((e as Error).message);
    return false;
  }
}

function toggleHidden(c: Category, visible: boolean) {
  updateCategory(c.id, { hidden: !visible });
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="分类管理" left-arrow @click-left="goBack" />
    <van-tabs v-model:active="type">
      <van-tab title="支出" name="expense" />
      <van-tab title="收入" name="income" />
    </van-tabs>

    <van-cell-group inset class="group">
      <van-cell v-for="{ c, sub, first, last } in list" :key="c.id" center clickable :class="{ child: sub }" @click="openEdit(c)">
        <template #icon>
          <CategoryIcon :icon="c.icon" :color="c.color" :size="32" class="icon" />
        </template>
        <template #title>
          <span :class="{ muted: c.hidden }">{{ c.name }}</span>
          <van-tag v-if="c.hidden" plain type="default" class="tag">已隐藏</van-tag>
        </template>
        <template #value>
          <div class="ops" @click.stop>
            <van-icon name="arrow-up" :class="{ disabled: first }" @click="moveCategory(c.id, 'up')" />
            <van-icon name="arrow-down" :class="{ disabled: last }" @click="moveCategory(c.id, 'down')" />
            <van-switch :model-value="!c.hidden" size="18px" @update:model-value="toggleHidden(c, $event)" />
          </div>
        </template>
      </van-cell>
    </van-cell-group>
    <div class="hint muted">关闭开关可隐藏分类；已有记录不受影响</div>

    <div class="add">
      <van-button block round type="primary" icon="plus" @click="openCreate()">新增分类</van-button>
    </div>

    <van-dialog
      v-model:show="show"
      :title="editing ? '编辑分类' : '新增分类'"
      show-cancel-button
      :before-close="beforeClose"
    >
      <van-field v-model="form.name" label="名称" placeholder="1–8 个字" maxlength="8" />
      <van-field label="上级分类">
        <template #input>
          <select v-model="form.parentId" class="parent-select" :disabled="!!editing">
            <option value="">无（一级分类）</option>
            <option v-for="t in tops" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </template>
      </van-field>
      <div class="emoji-grid">
        <span
          v-for="e in EMOJIS"
          :key="e"
          class="emoji"
          :class="{ on: form.icon === e }"
          @click="form.icon = e"
          >{{ e }}</span
        >
      </div>
    </van-dialog>
  </div>
</template>

<style scoped>
.group {
  margin-top: 12px;
}
.child {
  padding-left: 40px;
}
.parent-select {
  width: 100%;
  font-size: 14px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.icon {
  margin-right: 10px;
}
.tag {
  margin-left: 6px;
}
.ops {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  font-size: 18px;
}
.ops .disabled {
  opacity: 0.25;
  pointer-events: none;
}
.hint {
  font-size: 12px;
  padding: 8px 28px;
}
.add {
  padding: 12px 16px calc(24px + var(--safe-bottom));
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  padding: 8px 12px 12px;
  max-height: 200px;
  overflow-y: auto;
}
.emoji {
  font-size: 22px;
  text-align: center;
  padding: 4px 0;
  border-radius: 8px;
  cursor: pointer;
}
.emoji.on {
  background: var(--border);
  outline: 2px solid var(--primary);
}
</style>
