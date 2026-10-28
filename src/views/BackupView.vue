<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, ref } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import { useGoBack } from '@/composables/useGoBack';
import { can } from '@/stores/auth';
import { useLiveQuery } from '@/composables/useLiveQuery';
import {
  exportCsvBlob,
  exportJsonBlob,
  importBackup,
  LAST_BACKUP_KEY,
  markBackedUp,
  parseBackup,
  type BackupFile,
} from '@/services/backup';
import { getSetting } from '@/services/settings';
import { shareOrDownload } from '@/utils/share';

const goBack = useGoBack();
const lastBackupAt = useLiveQuery(() => getSetting<number>(LAST_BACKUP_KEY), null, undefined as number | undefined);
const lastText = computed(() =>
  lastBackupAt.value ? dayjs(lastBackupAt.value).format('YYYY-MM-DD HH:mm') : '从未备份',
);

async function onExportJson() {
  const ok = await shareOrDownload(await exportJsonBlob(), `ledger-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`);
  if (ok) {
    await markBackedUp();
    showToast('已导出');
  }
}

async function onExportCsv() {
  await shareOrDownload(await exportCsvBlob(), `ledger-${dayjs().format('YYYYMMDD')}.csv`);
}

const fileInput = ref<HTMLInputElement>();
const pending = ref<BackupFile | null>(null);
const showActions = ref(false);
const summary = computed(() => {
  const p = pending.value;
  if (!p) return '';
  const count = p.data.transactions.filter((t) => !t.deleted).length;
  return `备份时间 ${dayjs(p.exportedAt).format('YYYY-MM-DD HH:mm')}，流水 ${count} 条，分类 ${p.data.categories.length} 个`;
});
const actions = [
  { name: '合并到现有数据', value: 'merge' as const, subname: '保留现有数据，相同记录取较新的' },
  { name: '覆盖现有数据', value: 'overwrite' as const, subname: '所有设备的流水替换为备份内容', color: '#ee0a24' },
];

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    pending.value = parseBackup(await file.text());
    showActions.value = true;
  } catch (err) {
    showToast((err as Error).message);
  }
}

async function onSelect(action: (typeof actions)[number]) {
  showActions.value = false;
  const data = pending.value;
  if (!data) return;
  if (action.value === 'overwrite') {
    try {
      await showConfirmDialog({
        title: '覆盖现有数据？',
        message: '所有设备上的现有流水将被删除，替换为备份内容。',
        confirmButtonText: '覆盖',
        confirmButtonColor: '#ee0a24',
      });
    } catch {
      return;
    }
  }
  try {
    const r = await importBackup(data, action.value);
    showToast(
      action.value === 'overwrite'
        ? `已恢复 ${r.added} 条流水`
        : `导入完成：新增 ${r.added} 条，更新 ${r.updated} 条`,
    );
  } catch (err) {
    showToast('导入失败：' + (err as Error).message);
  } finally {
    pending.value = null;
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="备份与恢复" left-arrow @click-left="goBack" />

    <van-cell-group inset class="group">
      <van-cell title="上次备份" :value="lastText" />
    </van-cell-group>

    <van-cell-group v-if="can('backup.export')" inset class="group" title="导出">
      <van-cell title="导出完整备份（JSON）" label="可用于恢复数据" icon="down" is-link @click="onExportJson" />
      <van-cell title="导出表格（CSV）" label="可用 Excel 打开分析" icon="orders-o" is-link @click="onExportCsv" />
    </van-cell-group>

    <van-cell-group v-if="can('backup.import')" inset class="group" title="恢复">
      <van-cell title="从备份文件恢复" icon="replay" is-link @click="fileInput?.click()" />
    </van-cell-group>

    <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFileChange" />

    <div class="tip muted">
      数据已自动同步到云端。导出备份作为额外保险，建议存到「文件 → iCloud 云盘」。导入的数据会自动同步到所有设备。
    </div>

    <van-action-sheet
      v-model:show="showActions"
      :actions="actions"
      :description="summary"
      cancel-text="取消"
      close-on-click-action
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.group {
  margin-top: 12px;
}
.tip {
  font-size: 12px;
  line-height: 1.6;
  padding: 12px 28px;
}
</style>
