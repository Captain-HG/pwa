<script setup lang="ts">
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { computed, onMounted, ref } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import { useGoBack } from '@/composables/useGoBack';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  changePassword,
  describeDevice,
  getMe,
  listSessions,
  logout,
  revokeSession,
  type SessionInfo,
} from '@/services/session';
import { countPending, syncNow, syncState } from '@/sync/sync';
import { auth } from '@/stores/auth';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const goBack = useGoBack();
const username = ref('');
const sessions = ref<SessionInfo[]>([]);
const pending = useLiveQuery(countPending, null, 0);

const status = computed(() => {
  if (syncState.syncing) return '同步中…';
  if (syncState.error) return syncState.error;
  return syncState.lastSyncAt ? `上次同步 ${dayjs(syncState.lastSyncAt).fromNow()}` : '尚未同步';
});

async function load() {
  try {
    username.value = (await getMe()).username;
    sessions.value = await listSessions();
  } catch {
    // 离线时只显示同步状态
  }
}
onMounted(load);

async function onSync() {
  await syncNow();
  showToast(syncState.error ? syncState.error : '同步完成');
}

async function onRevoke(s: SessionInfo) {
  try {
    await showConfirmDialog({ title: '移除该设备？', message: '该设备将退出登录，并清除其本地数据。' });
  } catch {
    return;
  }
  try {
    await revokeSession(s.id);
    showToast('已移除');
    sessions.value = await listSessions();
  } catch (e) {
    showToast((e as Error).message);
  }
}

const showPwd = ref(false);
const pwd = ref({ old: '', next: '', confirm: '' });

function openPwd() {
  pwd.value = { old: '', next: '', confirm: '' };
  showPwd.value = true;
}

async function beforePwdClose(action: string): Promise<boolean> {
  if (action !== 'confirm') return true;
  if (pwd.value.next.length < 8) return showToast('新密码至少 8 位'), false;
  if (pwd.value.next !== pwd.value.confirm) return showToast('两次输入的新密码不一致'), false;
  try {
    await changePassword(pwd.value.old, pwd.value.next);
    showToast('密码已修改，其他设备已退出登录');
    sessions.value = await listSessions();
    return true;
  } catch (e) {
    showToast((e as Error).message);
    return false;
  }
}

async function onLogout() {
  await syncNow();
  const left = await countPending();
  try {
    await showConfirmDialog({
      title: '退出登录？',
      message: left
        ? `还有 ${left} 条记录未同步，退出后将丢失。`
        : '退出后本机数据会被清除，重新登录后从云端恢复。',
      confirmButtonText: '退出',
      confirmButtonColor: '#ee0a24',
    });
  } catch {
    return;
  }
  await logout();
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="账号与同步" left-arrow @click-left="goBack" />

    <van-cell-group inset class="group">
      <van-cell title="账号" :value="username || auth.me?.username || '—'" icon="user-o" />
      <van-cell v-if="auth.me?.displayName" title="显示名" :value="auth.me.displayName" />
      <van-cell title="角色" :value="auth.me?.role || '—'" />
    </van-cell-group>

    <van-cell-group inset class="group" title="同步">
      <van-cell title="同步状态" :value="status" :value-class="{ expense: !!syncState.error }" />
      <van-cell title="待同步" :value="`${pending} 条`" />
      <div class="btn-row">
        <van-button block round plain type="primary" :loading="syncState.syncing" @click="onSync">立即同步</van-button>
      </div>
    </van-cell-group>

    <van-cell-group inset class="group" title="登录设备">
      <van-cell
        v-for="s in sessions"
        :key="s.id"
        :title="describeDevice(s.userAgent) + (s.current ? ' · 本机' : '')"
        :label="`最近活动 ${dayjs(s.lastSeenAt).fromNow()} · 登录于 ${dayjs(s.createdAt).format('YYYY-MM-DD')}`"
        center
      >
        <template #value>
          <van-button v-if="!s.current" size="small" plain type="danger" @click="onRevoke(s)">移除</van-button>
        </template>
      </van-cell>
      <van-cell v-if="!sessions.length" title="离线时无法加载" />
    </van-cell-group>

    <van-cell-group inset class="group">
      <van-cell title="修改密码" icon="lock" is-link @click="openPwd" />
      <van-cell title="退出登录" icon="revoke" title-class="expense" is-link @click="onLogout" />
    </van-cell-group>

    <van-dialog v-model:show="showPwd" title="修改密码" show-cancel-button :before-close="beforePwdClose">
      <van-field v-model="pwd.old" type="password" label="原密码" autocomplete="current-password" />
      <van-field v-model="pwd.next" type="password" label="新密码" placeholder="至少 8 位" autocomplete="new-password" />
      <van-field v-model="pwd.confirm" type="password" label="确认新密码" autocomplete="new-password" />
    </van-dialog>
  </div>
</template>

<style scoped>
.group {
  margin-top: 12px;
}
.btn-row {
  padding: 10px 16px 14px;
}
</style>
