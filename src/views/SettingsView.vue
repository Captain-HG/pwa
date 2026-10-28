<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { clearAllTransactions, LAST_BACKUP_KEY } from '@/services/backup';
import { syncState } from '@/sync/sync';
import { auth, can } from '@/stores/auth';
import { getSetting } from '@/services/settings';

const version = __APP_VERSION__;
const lastBackupAt = useLiveQuery(() => getSetting<number>(LAST_BACKUP_KEY), null, undefined as number | undefined);
const backupText = computed(() => {
  if (!lastBackupAt.value) return '从未备份';
  const days = dayjs().diff(lastBackupAt.value, 'day');
  return days === 0 ? '今天已备份' : `上次备份：${days} 天前`;
});

const syncText = computed(() => {
  if (syncState.syncing) return '同步中…';
  if (syncState.error) return '同步失败';
  return syncState.lastSyncAt ? `已同步 ${dayjs(syncState.lastSyncAt).format('HH:mm')}` : '未同步';
});

const persisted = ref<boolean | null>(null);
onMounted(async () => {
  persisted.value = (await navigator.storage?.persisted?.()) ?? null;
});

const showReset = ref(false);
const confirmText = ref('');
const CONFIRM_WORD = '确认清空';

function openReset() {
  confirmText.value = '';
  showReset.value = true;
}

async function beforeResetClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  if (confirmText.value.trim() !== CONFIRM_WORD) {
    showToast(`请输入「${CONFIRM_WORD}」`);
    return false;
  }
  const n = await clearAllTransactions();
  showToast(`已清空 ${n} 条流水`);
  return true;
}
</script>

<template>
  <div class="page with-tabbar">
    <van-nav-bar title="设置" />
    <van-cell-group inset class="group">
      <van-cell
        :title="auth.me?.displayName || auth.me?.username || '账号与同步'"
        :label="auth.me?.role"
        icon="user-o"
        is-link
        to="/account"
        :value="syncText"
      />
    </van-cell-group>

    <van-cell-group v-if="can('bill.import')" inset class="group">
      <van-cell title="导入支付宝 / 微信账单" icon="balance-list-o" is-link to="/import" />
    </van-cell-group>

    <van-cell-group v-if="can('category.manage') || can('backup.export') || can('backup.import')" inset class="group">
      <van-cell v-if="can('category.manage')" title="分类管理" icon="apps-o" is-link to="/categories" />
      <van-cell
        v-if="can('backup.export') || can('backup.import')"
        title="备份与恢复"
        icon="description-o"
        is-link
        to="/backup"
        :value="backupText"
      />
    </van-cell-group>

    <van-cell-group v-if="can('admin.users') || can('admin.roles')" inset class="group" title="系统管理">
      <van-cell v-if="can('admin.users')" title="用户管理" icon="friends-o" is-link to="/admin/users" />
      <van-cell v-if="can('admin.roles')" title="角色与权限" icon="shield-o" is-link to="/admin/roles" />
    </van-cell-group>

    <van-cell-group v-if="can('backup.import')" inset class="group">
      <van-cell title="清空所有流水" icon="delete-o" title-class="expense" is-link @click="openReset" />
    </van-cell-group>

    <van-cell-group inset class="group">
      <van-cell title="版本" :value="'v' + version" />
      <van-cell
        title="本地存储持久化"
        :value="persisted === null ? '不支持' : persisted ? '已开启' : '未开启'"
        label="本机为离线缓存，云端为主数据"
      />
    </van-cell-group>

    <van-dialog
      v-model:show="showReset"
      title="清空所有流水"
      show-cancel-button
      confirm-button-text="清空"
      confirm-button-color="#ee0a24"
      :before-close="beforeResetClose"
    >
      <div class="reset-tip">将删除所有设备上的全部流水（分类保留），且无法恢复。建议先导出备份。</div>
      <van-field v-model="confirmText" :placeholder="`请输入「${CONFIRM_WORD}」`" />
    </van-dialog>
  </div>
</template>

<style scoped>
.group {
  margin-top: 12px;
}
.reset-tip {
  padding: 12px 20px 4px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.5;
}
</style>
