import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const PORT = Number(process.env.PLAYWRIGHT_PORT || 3010);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      V1_ALPHA_UI_ENABLED: "true",
      V1_ALPHA_APP_ENABLED: "true",
      V1_ALPHA_AUTH_ENABLED: "false",
      V1_ALLOWED_ORIGINS: `${BASE},http://localhost:${PORT}`,
      PORT: String(PORT),
    },
  },
});
