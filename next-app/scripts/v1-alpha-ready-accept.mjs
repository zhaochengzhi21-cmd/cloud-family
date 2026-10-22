/**
 * Unattended CF-ALPHA-READY acceptance runner (local).
 * Runs probes that do not need Playwright browser.
 *
 * Usage: node --env-file=.env.local scripts/v1-alpha-ready-accept.mjs
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, {
    cwd: app,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`FAIL ${label} exit=${r.status}`);
    process.exit(r.status || 1);
  }
  console.log(`PASS ${label}`);
}

run("sender-domain", "npm", ["run", "probe:sender-domain"]);
run("local-operability", "npm", ["run", "db:local-operability-smoke"]);
run("auth-http", "npm", ["run", "db:auth-http-smoke"]);
run("workspace-http", "npm", ["run", "db:workspace-http-smoke"]);
run("media-direct-upload", "npm", ["run", "db:media-direct-upload-smoke"]);
run("go-live-dry", "npm", ["run", "alpha:go-live:dry"]);

console.log("\nRESULT ACCEPT_CORE_PASS");
console.log("Still manual: Playwright E2E, git push, VERCEL_TOKEN --apply, prod redeploy");
