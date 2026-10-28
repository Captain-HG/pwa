import { ref } from 'vue';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = ref(mq.matches);

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value);
}

mq.addEventListener('change', (e) => {
  isDark.value = e.matches;
  apply();
});
apply();

/** 跟随系统深色模式 */
export function useDark() {
  return isDark;
}
