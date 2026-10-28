import dayjs from 'dayjs';
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 跨页面共享的界面状态：明细页与统计页使用同一个月份 */
export const useUiStore = defineStore('ui', () => {
  const month = ref(dayjs().format('YYYY-MM'));
  return { month };
});
