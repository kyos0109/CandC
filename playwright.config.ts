import { defineConfig } from '@playwright/test';
import path from 'node:path';
const port = Number(process.env.CANDC_FIXTURE_PORT ?? 4399);
export default defineConfig({ testDir: './e2e', timeout: 30_000, globalTimeout: 240_000, workers: 1, reporter: 'list', globalTeardown: './e2e/teardown.ts', outputDir: process.env.CANDC_E2E_OUTPUT_DIR ?? '.cache/playwright-results',
  use: { baseURL: `http://127.0.0.1:${port}`, launchOptions: { executablePath: process.env.CANDC_BROWSER_PATH ?? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe') }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:isolated && node tests/fixtures/web-server.mjs', url: `http://127.0.0.1:${port}/health`, timeout: 60_000, reuseExistingServer: false, stdout: 'pipe', gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 } } });
