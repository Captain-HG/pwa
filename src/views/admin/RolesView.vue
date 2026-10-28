<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import { useGoBack } from '@/composables/useGoBack';
import { createRole, deleteRole, listRoles, updateRole, type AdminRole } from '@/services/admin';
import { ALL, normalize, PERMISSIONS } from '../../../shared/permissions';

const goBack = useGoBack();
const roles = ref<AdminRole[]>([]);
const loading = ref(true);
const loadError = ref('');

async function load() {
  try {
    roles.value = await listRoles();
    loadError.value = '';
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const groups = computed(() => {
  const map = new Map<string, typeof PERMISSIONS>();
  for (const p of PERMISSIONS) map.set(p.group, [...(map.get(p.group) ?? []), p]);
  return [...map.entries()];
});

const isAdminRole = (r: AdminRole) => r.permissions.includes(ALL);
const summary = (r: AdminRole) => (isAdminRole(r) ? '全部权限' : `${r.permissions.length} 项权限`);

// ---------- 新建 / 编辑 ----------
const show = ref(false);
const editing = ref<AdminRole | null>(null);
const form = ref({ name: '', description: '', permissions: [] as string[] });
const readonly = computed(() => !!editing.value && isAdminRole(editing.value));

function openCreate() {
  editing.value = null;
  form.value = { name: '', description: '', permissions: ['ledger.view', 'stats.view'] };
  show.value = true;
}

function openEdit(r: AdminRole) {
  editing.value = r;
  form.value = { name: r.name, description: r.description, permissions: [...r.permissions] };
  show.value = true;
}

/** 勾选「记账」等权限时自动带上前置权限 */
function onPermsChange(value: string[]) {
  form.value.permissions = normalize(value);
}

async function save() {
  try {
    if (editing.value) await updateRole(editing.value.id, form.value);
    else await createRole(form.value);
    showToast('已保存');
    show.value = false;
    await load();
  } catch (e) {
    showToast((e as Error).message);
  }
}

async function remove() {
  const r = editing.value!;
  try {
    await showConfirmDialog({ title: `删除角色「${r.name}」？`, confirmButtonText: '删除', confirmButtonColor: '#ee0a24' });
  } catch {
    return;
  }
  try {
    await deleteRole(r.id);
    showToast('已删除');
    show.value = false;
    await load();
  } catch (e) {
    showToast((e as Error).message);
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="角色与权限" left-arrow right-text="新建" @click-left="goBack" @click-right="openCreate" />

    <van-loading v-if="loading" class="center" />
    <van-empty v-else-if="loadError" image="network" :description="loadError" />

    <van-cell-group v-else inset class="group">
      <van-cell v-for="r in roles" :key="r.id" center is-link :value="`${r.userCount} 人`" @click="openEdit(r)">
        <template #title>
          {{ r.name }}
          <van-tag v-if="r.builtin" plain class="tag">预置</van-tag>
        </template>
        <template #label>{{ summary(r) }}{{ r.description ? ' · ' + r.description : '' }}</template>
      </van-cell>
    </van-cell-group>

    <div class="hint muted">权限变更后立即生效，相关用户回到 App 时菜单会自动更新。</div>

    <van-popup v-model:show="show" position="bottom" round closeable teleport="body" class="popup">
      <div class="sheet">
        <div class="sheet-title">{{ editing ? (readonly ? editing.name : '编辑角色') : '新建角色' }}</div>

        <template v-if="readonly">
          <div class="tip">管理员拥有全部权限（包括以后新增的功能），不能修改。</div>
        </template>
        <template v-else>
          <van-cell-group inset>
            <van-field v-model="form.name" label="名称" placeholder="1–20 个字" maxlength="20" />
            <van-field v-model="form.description" label="说明" placeholder="选填" maxlength="60" />
          </van-cell-group>

          <van-checkbox-group :model-value="form.permissions" @update:model-value="onPermsChange">
            <div v-for="[group, items] in groups" :key="group">
              <div class="sub-title">{{ group }}</div>
              <van-cell-group inset>
                <van-cell v-for="p in items" :key="p.key" :title="p.name" :label="p.key" center>
                  <template #right-icon>
                    <van-checkbox :name="p.key" shape="square" />
                  </template>
                </van-cell>
              </van-cell-group>
            </div>
          </van-checkbox-group>
          <div class="tip">勾选「记账」会自动包含「查看明细」；「导入备份 / 清空流水」会自动包含「记账」。</div>

          <div class="actions">
            <van-button block round type="primary" @click="save">保存</van-button>
            <van-button v-if="editing && !editing.builtin" block round plain type="danger" @click="remove">删除角色</van-button>
          </div>
        </template>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.group {
  margin-top: 12px;
}
.center {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
.tag {
  margin-left: 6px;
}
.hint {
  font-size: 12px;
  padding: 8px 28px;
}
.popup {
  max-height: 85vh;
}
.sheet {
  padding: 16px 0 calc(16px + var(--safe-bottom));
}
.sheet-title {
  text-align: center;
  font-weight: 600;
  margin-bottom: 12px;
}
.sub-title {
  font-size: 13px;
  color: var(--text-2);
  padding: 14px 28px 6px;
}
.tip {
  padding: 10px 28px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 16px 0;
}
</style>
