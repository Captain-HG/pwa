<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, ref } from 'vue';

const month = defineModel<string>({ required: true });
const show = ref(false);
const picker = ref<string[]>([]);
const minDate = new Date(2015, 0, 1);
const maxDate = new Date(2035, 11, 31);

const label = computed(() => dayjs(month.value + '-01').format('YYYY年M月'));

function shift(n: number) {
  month.value = dayjs(month.value + '-01').add(n, 'month').format('YYYY-MM');
}

function open() {
  picker.value = month.value.split('-');
  show.value = true;
}

function onConfirm({ selectedValues }: { selectedValues: string[] }) {
  month.value = selectedValues.join('-');
  show.value = false;
}
</script>

<template>
  <div class="month-switcher">
    <van-icon name="arrow-left" class="arrow" @click="shift(-1)" />
    <span class="label" @click="open">{{ label }} <van-icon name="arrow-down" size="12" /></span>
    <van-icon name="arrow" class="arrow" @click="shift(1)" />
    <van-popup v-model:show="show" position="bottom" round teleport="body">
      <van-date-picker
        v-model="picker"
        title="选择月份"
        :columns-type="['year', 'month']"
        :min-date="minDate"
        :max-date="maxDate"
        @confirm="onConfirm"
        @cancel="show = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.month-switcher {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  height: 44px;
  font-size: 16px;
  font-weight: 600;
}
.arrow {
  padding: 8px;
  cursor: pointer;
  color: var(--text-2);
}
.label {
  cursor: pointer;
}
</style>
