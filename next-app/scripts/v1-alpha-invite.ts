/**
 * Operator script: create / revoke Closed Alpha invites.
 * Prefer interactive stdin — avoid email in shell history.
 *
 * Usage:
 *   npx tsx scripts/v1-alpha-invite.ts create
 *   npx tsx scripts/v1-alpha-invite.ts revoke <inviteId>
 */

import { config } from "dotenv";
import * as readline from "readline";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import {
  createAlphaInvite,
  revokeAlphaInvite,
} from "../src/v1/services/alphaInviteService";

config({ path: ".env.local" });
config({ path: ".env" });

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const tip = local.slice(0, Math.min(2, local.length));
  return `${tip}***@${domain}`;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const cmd = process.argv[2];
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB / Auth keys not configured");
    process.exit(2);
  }
  getV1Db();

  try {
    if (cmd === "create") {
      const email = (await prompt("Email (not logged): ")).trim();
      const result = await createAlphaInvite(email);
      console.log("inviteId:", result.inviteId);
      console.log("expiresAt:", result.expiresAt.toISOString());
      console.log("email:", maskEmail(email));
      console.log("--- raw invite token (show once; store offline) ---");
      console.log(result.rawToken);
      console.log("--- end ---");
    } else if (cmd === "revoke") {
      const id = process.argv[3];
      if (!id) {
        console.error("Usage: revoke <inviteId>");
        process.exit(2);
      }
      const ok = await revokeAlphaInvite(id);
      console.log(ok ? "revoked" : "not_revoked");
    } else {
      console.error("Usage: create | revoke <inviteId>");
      process.exit(2);
    }
  } finally {
    await closeV1Db();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "failed");
  process.exit(1);
});
