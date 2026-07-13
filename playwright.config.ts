import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './electron',
  testMatch: 'smoke.e2e.ts',
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  workers: 1,
  fullyParallel: false,
  reporter: 'line',
})