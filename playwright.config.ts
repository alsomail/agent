import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./app/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  webServer: [
    {
      command: "cd app/service && npx tsx --env-file=../../.env src/index.ts",
      port: 3001,
      timeout: 10_000,
      reuseExistingServer: true,
    },
  ],
});
