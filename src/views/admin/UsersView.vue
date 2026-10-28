<script setup lang="ts">
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { useGoBack } from '@/composables/useGoBack';
import {
  createUser,
  deleteUser,
  listRoles,
  listUsers,
  resetUserPassword,
  updateUser,
  type AdminRole,
  type AdminUser,
} from '@/services/admin';
import { auth } from '@/stores/auth';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const goBack = useGoBack();
const users = ref<AdminUser[]>([]);
const roles = ref<AdminRole[]>([]);
const loading = ref(true);
const loadError = ref('');

async function load() {
  try {
    [users.value, roles.value] = await Promise.all([listUsers(), listRoles()]);
    loadError.value = '';
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const isSelf = (u: AdminUser) => u.id === auth.me?.id;
const lastSeen = (u: AdminUser) => (u.lastSeenAt ? `最近活动 ${dayjs(u.lastSeenAt).fromNow()}` : '从未登录');

function toastError(e: unknown) {
  showToast((e as Error).message);
}

// ---------- 新建 ----------
const showCreate = ref(false);
const form = ref({ username: '', displayName: '', password: '', roleId: 2 });

function openCreate() {
  form.value = { username: '', displayName: '', password: '', roleId: roles.value.find((r) => r.id === 2)?.id ?? roles.value[0]?.id ?? 2 };
  showCreate.value = true;
}

async function beforeCreateClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  try {
    await createUser({ ...form.value, username: form.value.username.trim() });
    showToast('已创建');
    await load();
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// ---------- 编辑 ----------
const editing = ref<AdminUser | null>(null);
const edit = ref({ displayName: '', roleId: 0, enabled: true });
const showEdit = computed({
  get: () => !!editing.value,
  set: (v) => {
    if (!v) editing.value = null;
  },
});

function openEdit(u: AdminUser) {
  editing.value = u;
  edit.value = { displayName: u.displayName, roleId: u.roleId, enabled: !u.disabled };
}

async function saveEdit() {
  const u = editing.value!;
  const body: Parameters<typeof updateUser>[1] = { displayName: edit.value.displayName };
  if (!isSelf(u)) {
    body.roleId = edit.value.roleId;
    body.disabled = !edit.value.enabled;
  }
  try {
    await updateUser(u.id, body);
    showToast('已保存');
    editing.value = null;
    await load();
  } catch (e) {
    toastError(e);
  }
}

const showReset = ref(false);
const newPassword = ref('');

function openReset() {
  newPassword.value = '';
  showReset.value = true;
}

async function beforeResetClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  try {
    await resetUserPassword(editing.value!.id, newPassword.value);
    showToast('密码已重置，该用户需重新登录');
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

const showDelete = ref(false);
const confirmName = ref('');

function openDelete() {
  confirmName.value = '';
  showDelete.value = true;
}

async function beforeDeleteClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  const u = editing.value!;
  if (confirmName.value.trim() !== u.username) {
    showToast('请输入该用户的用户名');
    return false;
  }
  try {
    await deleteUser(u.id);
    showToast('已删除');
    editing.value = null;
    await load();
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

</script>

<template>
  <div class="page">
    <van-nav-bar title="用户管理" left-arrow right-text="新建" @click-left="goBack" @click-right="openCreate" />

    <van-loading v-if="loading" class="center" />
    <van-empty v-else-if="loadError" image="network" :description="loadError" />

    <van-cell-group v-else inset class="group">
      <van-cell v-for="u in users" :key="u.id" center is-link @click="openEdit(u)">
        <template #title>
          <span :class="{ muted: u.disabled }">{{ u.displayName || u.username }}</span>
          <van-tag v-if="isSelf(u)" type="primary" plain class="tag">我</van-tag>
          <van-tag v-if="u.disabled" type="danger" plain class="tag">已停用</van-tag>
        </template>
        <template #label>@{{ u.username }} · {{ lastSeen(u) }}</template>
        <template #value>
          <span class="role">{{ u.roleName }}</span>
        </template>
      </van-cell>
    </van-cell-group>

    <div class="hint muted">新用户各自拥有独立账本，互相看不到对方的数据。</div>

    <!-- 新建用户 -->
    <van-dialog v-model:show="showCreate" title="新建用户" show-cancel-button :before-close="beforeCreateClose">
      <van-field v-model="form.username" label="用户名" placeholder="字母、数字、_ . -" autocapitalize="off" autocomplete="off" />
      <van-field v-model="form.displayName" label="显示名" placeholder="选填，如：小明" />
      <van-field v-model="form.password" type="password" label="初始密码" placeholder="至少 8 位" autocomplete="new-password" />
      <div class="sub-title">角色</div>
      <van-radio-group v-model="form.roleId" class="radios">
        <van-radio v-for="r in roles" :key="r.id" :name="r.id">{{ r.name }}</van-radio>
      </van-radio-group>
    </van-dialog>

    <!-- 编辑用户 -->
    <van-popup v-model:show="showEdit" position="bottom" round closeable teleport="body">
      <div v-if="editing" class="sheet">
        <div class="sheet-title">{{ editing.username }}{{ isSelf(editing) ? '（我）' : '' }}</div>
        <van-cell-group inset>
          <van-field v-model="edit.displayName" label="显示名" placeholder="选填" />
          <van-cell title="启用" center>
            <template #value>
              <van-switch v-model="edit.enabled" size="20px" :disabled="isSelf(editing)" />
            </template>
          </van-cell>
        </van-cell-group>
        <div class="sub-title">角色{{ isSelf(editing) ? '（不能修改自己的角色）' : '' }}</div>
        <van-radio-group v-model="edit.roleId" class="radios" :disabled="isSelf(editing)">
          <van-radio v-for="r in roles" :key="r.id" :name="r.id">{{ r.name }}</van-radio>
        </van-radio-group>
        <div class="actions">
          <van-button block round type="primary" @click="saveEdit">保存</van-button>
          <van-button block round plain @click="openReset">重置密码</van-button>
          <van-button v-if="!isSelf(editing)" block round plain type="danger" @click="openDelete">删除用户</van-button>
        </div>
      </div>
    </van-popup>

    <van-dialog v-model:show="showReset" title="重置密码" show-cancel-button :before-close="beforeResetClose">
      <div class="tip">重置后该用户所有设备会退出登录。</div>
      <van-field v-model="newPassword" type="password" label="新密码" placeholder="至少 8 位" autocomplete="new-password" />
    </van-dialog>

    <van-dialog
      v-model:show="showDelete"
      title="删除用户"
      show-cancel-button
      confirm-button-text="删除"
      confirm-button-color="#ee0a24"
      :before-close="beforeDeleteClose"
    >
      <div class="tip">将同时删除该用户的全部云端账目，且无法恢复。请输入用户名「{{ editing?.username }}」确认。</div>
      <van-field v-model="confirmName" placeholder="输入用户名" autocapitalize="off" />
    </van-dialog>
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
.role {
  color: var(--text-2);
}
.hint {
  font-size: 12px;
  padding: 8px 28px;
}
.sub-title {
  font-size: 13px;
  color: var(--text-2);
  padding: 14px 20px 6px;
}
.radios {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 4px 20px 12px;
}
.sheet {
  padding: 16px 0 calc(16px + var(--safe-bottom));
}
.sheet-title {
  text-align: center;
  font-weight: 600;
  margin-bottom: 12px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 16px 0;
}
.tip {
  padding: 12px 20px 4px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.5;
}
</style>
