import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';
import { pagesDevPlugin } from './dev/pages-dev-plugin';

export default defineConfig({
  // 相对路径，部署到 GitHub Pages 子目录或 Cloudflare Pages 根目录都可用
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    // 本地模拟 Pages Functions（登录、鉴权、/api），仅 npm run dev 时生效
    pagesDevPlugin(fileURLToPath(new URL('.', import.meta.url))),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '我的记账',
        short_name: '记账',
        description: '个人记账',
        lang: 'zh-CN',
        theme_color: '#1989fa',
        background_color: '#f7f8fa',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 登录页与接口必须走网络，不能被离线页面拦截
        navigateFallbackDenylist: [/^\/api\//, /^\/login/],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
