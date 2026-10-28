<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import echarts from '@/charts/echarts';

const props = withDefaults(defineProps<{ option: EChartsCoreOption; height?: string }>(), { height: '240px' });
const emit = defineEmits<{ click: [params: { dataIndex: number; data: unknown; name: string }] }>();

const el = ref<HTMLDivElement>();
const chart = shallowRef<ECharts>();
const onResize = () => chart.value?.resize();

onMounted(() => {
  chart.value = echarts.init(el.value!);
  chart.value.setOption(props.option);
  chart.value.on('click', (p) => emit('click', p as unknown as { dataIndex: number; data: unknown; name: string }));
  window.addEventListener('resize', onResize);
});

watch(
  () => props.option,
  (o) => chart.value?.setOption(o, true),
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  chart.value?.dispose();
});
</script>

<template>
  <div ref="el" :style="{ height: props.height, width: '100%' }" />
</template>
