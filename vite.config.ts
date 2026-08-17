import { fileURLToPath, URL } from 'node:url'
// From 'vitest/config', not 'vite' — it is the variant that types the
// `test` block below.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/stac-api-browser/' : '/',
  plugins: [vue()],
  // MapLibre spawns its worker with `{ type: 'module' }`, so the worker asset
  // has to be ES too. The default ('iife') would force MapLibre down its
  // classic-worker fallback path.
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Escape hatch only. The Lantmäteriet STAC APIs send
    // `access-control-allow-origin: *` and the asset host allows the
    // `Authorization` header on preflight, so the app talks to them directly
    // and needs no proxy. Kept for third-party catalogs that lack CORS.
    proxy: {
      // '/proxy/stac': {
      //   target: 'https://api.lantmateriet.se',
      //   changeOrigin: true,
      //   rewrite: (p) => p.replace(/^\/proxy\/stac/, ''),
      // },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
