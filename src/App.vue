<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import TabBar from '@/components/TabBar.vue';
import { useDark } from '@/composables/useDark';

const route = useRoute();
const isDark = useDark();
const theme = computed(() => (isDark.value ? 'dark' : 'light'));
</script>

<template>
  <van-config-provider :theme="theme">
    <router-view />
    <TabBar v-if="route.meta.tab" />
  </van-config-provider>
</template>
