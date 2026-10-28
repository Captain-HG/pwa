<script setup lang="ts">
const props = withDefaults(defineProps<{ icon: string; color?: string; size?: number; active?: boolean }>(), {
  color: '#1989fa',
  size: 36,
  active: false,
});
</script>

<template>
  <span
    class="cat-icon"
    :style="{
      width: props.size + 'px',
      height: props.size + 'px',
      fontSize: props.size * 0.5 + 'px',
      background: props.active ? props.color : props.color + '26',
      boxShadow: props.active ? `0 0 0 2px ${props.color}55` : 'none',
    }"
    >{{ props.icon }}</span
  >
</template>

<style scoped>
.cat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.15s;
}
</style>
