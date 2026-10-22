/**
 * CF-ALPHA-READY unattended go-live helper.
 *
 * Requires: VERCEL_TOKEN (+ optional VERCEL_ORG_ID / VERCEL_PROJECT_ID)
 * Does NOT open gates unless --apply is passed.
 *
 * Usage:
 *   node --env-file=.env.local scripts/v1-alpha-go-live.mjs           # dry-run
 *   node --env-file=.env.local scripts/v1-alpha-go-live.mjs --apply   # set env + note redeploy
 */

const APPLY = process.argv.includes("--apply");
const ORG =
  process.env.VERCEL_ORG_ID ||
  process.env.VERCEL_TEAM_ID ||
  "team_94M0iKR2fnOiWoKOfBKo2bwp";
const PROJECT =
  process.env.VERCEL_PROJECT_ID || "prj_074nbeY3yNP2pGKRRS9dDDyCGY1F";
const TOKEN = process.env.VERCEL_TOKEN?.trim();

const WANT = [
  { key: "V1_AUTH_SENDER_VERIFIED", value: "true" },
  {
    key: "V1_AUTH_EMAIL_FROM",
    value:
      process.env.V1_AUTH_EMAIL_FROM?.trim() ||
      "云族谱 <noreply@mianmianguadie.com>",
  },
  { key: "V1_ALPHA_AUTH_ENABLED", value: "true" },
  { key: "V1_ALPHA_APP_ENABLED", value: "true" },
  { key: "V1_ALPHA_UI_ENABLED", value: "true" },
];

const FORBID = ["V1_OTP_DELIVERY", "V1_BLOB_LOCAL_FINALIZE"];

async function api(path, init = {}) {
  const url = path.includes("?")
    ? `https://api.vercel.com${path}&teamId=${ORG}`
    : `https://api.vercel.com${path}?teamId=${ORG}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function listEnv() {
  const r = await api(`/v9/projects/${PROJECT}/env`);
  if (r.status !== 200) {
    throw new Error(`list env status=${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json.envs || [];
}

async function upsertEnv(key, value) {
  const envs = await listEnv();
  const existing = envs.find(
    (e) => e.key === key && (e.target || []).includes("production")
  );
  if (existing) {
    const r = await api(`/v9/projects/${PROJECT}/env/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ value, target: ["production"] }),
    });
    return { action: "patch", status: r.status, key };
  }
  const r = await api(`/v10/projects/${PROJECT}/env`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production"],
    }),
  });
  return { action: "create", status: r.status, key };
}

async function main() {
  console.log(`go-live mode=${APPLY ? "APPLY" : "DRY_RUN"} project=${PROJECT}`);
  if (!TOKEN) {
    console.error("FAIL VERCEL_TOKEN missing — cannot talk to Vercel API");
    console.error(
      "Set VERCEL_TOKEN then re-run. Gates will not flip without --apply."
    );
    process.exit(2);
  }

  const envs = await listEnv();
  const byKey = new Map(envs.map((e) => [e.key, e]));

  for (const f of FORBID) {
    const hit = byKey.get(f);
    if (hit && (hit.value === "true" || hit.value === "console")) {
      console.error(`FAIL forbidden_env_present ${f}`);
      process.exit(1);
    }
    console.log(`PASS forbid_absent ${f}`);
  }

  for (const w of WANT) {
    const cur = byKey.get(w.key);
    const curVal = cur?.value;
    const ok = curVal === w.value;
    console.log(
      `${ok ? "PASS" : "NEED"} ${w.key} current=${cur ? "(set)" : "(missing)"} want=${w.value}`
    );
    if (APPLY && !ok) {
      const r = await upsertEnv(w.key, w.value);
      console.log(
        `${r.status >= 200 && r.status < 300 ? "SET" : "FAIL"} ${r.action} ${r.key} status=${r.status}`
      );
      if (r.status < 200 || r.status >= 300) process.exit(1);
    }
  }

  if (!APPLY) {
    console.log("RESULT DRY_RUN — re-run with --apply after review");
    return;
  }

  console.log(
    "RESULT ENV_APPLIED — trigger redeploy (git push or vercel --prod) then probe /alpha"
  );
}

main().catch((e) => {
  console.error("FAIL", e?.message || e);
  process.exit(1);
});
