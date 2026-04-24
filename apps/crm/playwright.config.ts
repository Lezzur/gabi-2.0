import { defineConfig, devices } from '@playwright/test'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

// Explicitly load .env.test — production env is never touched here
loadDotenv({ path: resolve(__dirname, '../../.env.test') })
loadDotenv({ path: resolve(__dirname, '../../.env.test.local'), override: true })

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    env: {
      // Route the CRM dev server to the isolated test Supabase project
      NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL_TEST ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY_TEST ?? '',
    },
  },
})
