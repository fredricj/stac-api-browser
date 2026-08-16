import { defineConfig, devices } from '@playwright/test'

// E2E specs land in Phase 8. This config exists so `npm run test:e2e` is
// wired up from the start.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The map-rendering spec reaches the MapLibre instance through Vue's
      // `__vueParentComponent`, which only exists in a development build.
      command: 'npm run dev -- --port 5199',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
