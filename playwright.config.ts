import { defineConfig } from '@playwright/test';
const port = Number(process.env.CANDC_FIXTURE_PORT ?? 4399);
export default defineConfig({ testDir: './e2e', timeout: 30_000, globalTimeout: 360_000, workers: 1, reporter: 'list', globalTeardown: './e2e/teardown.ts', outputDir: process.env.CANDC_E2E_OUTPUT_DIR ?? '.cache/playwright-results',
  use: { baseURL: `http://127.0.0.1:${port}`, launchOptions: process.env.CANDC_BROWSER_PATH ? { executablePath: process.env.CANDC_BROWSER_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:isolated && node tests/fixtures/web-server.mjs', url: `http://127.0.0.1:${port}/health`, timeout: 60_000, reuseExistingServer: false, stdout: 'pipe', gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 } } });
