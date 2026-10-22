/**
 * CF-ALPHA-READY — Production isolation probe (read-only).
 * Asserts Closed Alpha stays fail-closed on live site until ops flips gates.
 *
 * Usage: node scripts/v1-prod-isolation-probe.mjs
 * Optional: PROD_BASE_URL=https://...
 */

const BASE =
  process.env.PROD_BASE_URL?.replace(/\/$/, "") ||
  "https://cloud-family.vercel.app";

const checks = [
  { path: "/", expectStatus: 200, name: "homepage" },
  { path: "/alpha", expectStatus: 404, name: "alpha_root_gated" },
  { path: "/alpha/login", expectStatus: 404, name: "alpha_login_gated" },
  { path: "/alpha/families", expectStatus: 404, name: "alpha_families_gated" },
  {
    path: "/api/v1/auth/me",
    expectStatus: 404,
    name: "v1_auth_me_gated",
  },
  {
    path: "/api/v1/families",
    expectStatus: 404,
    name: "v1_families_gated",
  },
  {
    path: "/api/v1/media/upload",
    expectStatus: 404,
    name: "v1_media_gated",
  },
];

async function probe(path, expectStatus) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/html,application/json" },
  });
  return { url, status: res.status, ok: res.status === expectStatus };
}

async function main() {
  console.log(`PROD_ISOLATION_PROBE base=${BASE}`);
  let fail = 0;
  for (const c of checks) {
    try {
      const r = await probe(c.path, c.expectStatus);
      const mark = r.ok ? "PASS" : "FAIL";
      if (!r.ok) fail++;
      console.log(
        `${mark} ${c.name} ${r.url} status=${r.status} expect=${c.expectStatus}`
      );
    } catch (e) {
      fail++;
      console.log(`FAIL ${c.name} ${c.path} error=${e?.message || e}`);
    }
  }
  if (fail) {
    console.error(`RESULT FAIL ${fail}/${checks.length}`);
    process.exit(1);
  }
  console.log(`RESULT PASS ${checks.length}/${checks.length}`);
}

main();
