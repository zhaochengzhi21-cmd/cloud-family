/**
 * Start Next.js with Closed Alpha gates ON for local Preview only.
 * Does NOT change Production env. Production gates stay fail-closed.
 *
 * Usage: npm run alpha:dev
 */

import { spawn } from "child_process";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

const port = process.env.ALPHA_DEV_PORT || "3010";
const origin = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  V1_ALPHA_UI_ENABLED: "true",
  V1_ALPHA_APP_ENABLED: "true",
  V1_ALPHA_AUTH_ENABLED: "true",
  V1_OTP_DELIVERY: process.env.V1_OTP_DELIVERY || "console",
  V1_BLOB_LOCAL_FINALIZE: "true",
  V1_ALLOWED_ORIGINS:
    process.env.V1_ALLOWED_ORIGINS ||
    `${origin},http://localhost:${port}`,
  PORT: port,
};

console.log("");
console.log("=== Cloud Family Alpha Local Preview ===");
console.log(`URL:  ${origin}/alpha`);
console.log("Gates: UI+APP+AUTH = true (process only)");
console.log("OTP:   V1_OTP_DELIVERY=console → codes in this terminal");
console.log("Blob:  V1_BLOB_LOCAL_FINALIZE=true (localhost webhook substitute)");
console.log("Production env is NOT modified.");
console.log("");

const child = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
