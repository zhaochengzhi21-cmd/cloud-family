/**
 * Local-only bootstrap: create one Alpha invite for Preview login testing.
 * Prints token once. Does not send email. Does not touch Production gates.
 *
 * Usage:
 *   npx tsx scripts/v1-alpha-local-bootstrap.ts you@example.com
 */

import { config } from "dotenv";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { createAlphaInvite } from "../src/v1/services/alphaInviteService";

config({ path: ".env.local" });
config({ path: ".env" });

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

async function main() {
  const email = (process.argv[2] || "").trim();
  if (!email || !email.includes("@")) {
    console.error("Usage: npx tsx scripts/v1-alpha-local-bootstrap.ts <email>");
    process.exit(2);
  }
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB / Auth keys not configured");
    process.exit(2);
  }
  getV1Db();
  try {
    const result = await createAlphaInvite(email);
    console.log("");
    console.log("=== Local Alpha invite (show once) ===");
    console.log("email:", maskEmail(email));
    console.log("inviteId:", result.inviteId);
    console.log("expiresAt:", result.expiresAt.toISOString());
    console.log("rawToken:", result.rawToken);
    console.log("");
    console.log("Next:");
    console.log("  1) npm run alpha:dev");
    console.log("  2) open /alpha/login — paste email + invite token");
    console.log("  3) OTP appears in the alpha:dev terminal (V1_OTP_DELIVERY=console)");
    console.log("");
  } finally {
    await closeV1Db();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "failed");
  process.exit(1);
});
