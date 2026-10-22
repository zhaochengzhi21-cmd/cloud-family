/**
 * CF-ALPHA-READY — Resend sender domain probe (no secrets logged).
 *
 * Checks:
 * 1) RESEND_API_KEY present
 * 2) From-host domain status via Resend Domains API
 * 3) Optional live send to *@resend.dev (always allowed)
 * 4) Optional human send only when V1_AUTH_SENDER_VERIFIED=true + V1_SENDER_PROBE_TO set
 *
 * Usage (from next-app):
 *   node --env-file=.env.local scripts/v1-sender-domain-probe.mjs
 */

import { randomUUID } from "crypto";

function fromHost() {
  const raw =
    process.env.V1_AUTH_EMAIL_FROM?.trim() ||
    "云族谱 <noreply@mianmianguadie.com>";
  const m = raw.match(/@([^>\s]+)/);
  return (m?.[1] || "").toLowerCase();
}

function getFrom() {
  return (
    process.env.V1_AUTH_EMAIL_FROM?.trim() ||
    "云族谱 <noreply@mianmianguadie.com>"
  );
}

async function main() {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    console.error("FAIL resend_key missing");
    process.exit(1);
  }
  console.log("PASS resend_key present");

  const host = fromHost();
  console.log(`INFO from_host=${host}`);

  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`FAIL domains_api status=${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const domains = body.data || [];
  const hit = domains.find(
    (d) => d.name === host || host.endsWith(`.${d.name}`)
  );
  if (!hit) {
    console.error(`FAIL domain_not_in_resend host=${host}`);
    process.exit(1);
  }
  if (hit.status !== "verified") {
    console.error(`FAIL domain_status=${hit.status} expected=verified`);
    process.exit(1);
  }
  console.log(`PASS domain_verified name=${hit.name} region=${hit.region}`);

  const flag = process.env.V1_AUTH_SENDER_VERIFIED === "true";
  console.log(
    flag
      ? "PASS sender_verified_flag true"
      : "INFO sender_verified_flag unset (ops must set before Production Alpha)"
  );

  // Live test address
  const testTo = `delivered+cf-alpha-${randomUUID().slice(0, 8)}@resend.dev`;
  const sendTest = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getFrom(),
      to: testTo,
      subject: "云族谱 sender probe (resend.dev)",
      text: "Closed Alpha sender probe — ignore.",
    }),
  });
  const sendBody = await sendTest.json().catch(() => ({}));
  if (!sendTest.ok) {
    console.error(
      `FAIL resend_dev_send status=${sendTest.status} code=${sendBody?.name || sendBody?.message || "?"}`
    );
    process.exit(1);
  }
  console.log("PASS resend_dev_send accepted");

  const humanTo = process.env.V1_SENDER_PROBE_TO?.trim();
  if (humanTo) {
    if (!flag) {
      console.error(
        "FAIL human_probe blocked: set V1_AUTH_SENDER_VERIFIED=true first"
      );
      process.exit(1);
    }
    const human = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFrom(),
        to: humanTo,
        subject: "云族谱 sender probe",
        text: "Closed Alpha human sender probe — ignore if unexpected.",
      }),
    });
    const hb = await human.json().catch(() => ({}));
    if (!human.ok) {
      console.error(
        `FAIL human_send status=${human.status} detail=${hb?.name || hb?.message || "?"}`
      );
      process.exit(1);
    }
    console.log("PASS human_send accepted (check inbox)");
  } else {
    console.log("SKIP human_send (set V1_SENDER_PROBE_TO to enable)");
  }

  console.log(
    flag
      ? "RESULT READY_FOR_GATE_FLIP"
      : "RESULT PROVIDER_READY_SET_V1_AUTH_SENDER_VERIFIED"
  );
}

main().catch((e) => {
  console.error("FAIL", e?.message || e);
  process.exit(1);
});
