/**
 * Agent channel HTTP smoke — GET /agent, propose + Idempotency-Key replay,
 * review-batch, soft-delete restore, evidence linkCount batch.
 * Synthetic data; full cleanup. Does not touch Production gates permanently.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  sessions,
  families,
  claims,
  claimEvidence,
} from "../src/db/schema";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { createSession } from "../src/v1/services/authService";
import { V1_SESSION_COOKIE_NAME } from "../src/v1/domain/auth/types";

import * as familiesRoot from "../src/app/api/v1/families/route";
import * as agentRoute from "../src/app/api/v1/families/[familyId]/agent/route";
import * as proposeRoute from "../src/app/api/v1/families/[familyId]/agent/propose/route";
import * as reviewBatchRoute from "../src/app/api/v1/families/[familyId]/claims/review-batch/route";
import * as personIdRoute from "../src/app/api/v1/families/[familyId]/persons/[personId]/route";
import * as personRestoreRoute from "../src/app/api/v1/families/[familyId]/persons/[personId]/restore/route";
import * as evidenceRoute from "../src/app/api/v1/families/[familyId]/evidence/route";
import * as overviewRoute from "../src/app/api/v1/families/[familyId]/overview/route";

config({ path: ".env.local" });
config({ path: ".env.development.local" });
config({ path: ".env" });

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
function pass(name: string, detail = "ok") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name} — ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}

const ORIGIN_OK = "https://cloud-family.vercel.app";
const trackedUserIds: string[] = [];

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  trackedUserIds.push(id);
}

async function sessionCookie(userId: string): Promise<string> {
  const { sessionToken } = await createSession(userId);
  return `${V1_SESSION_COOKIE_NAME}=${sessionToken}`;
}

function makeReq(
  method: string,
  url: string,
  opts: {
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (method !== "GET") headers.set("origin", ORIGIN_OK);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v);
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function readJson(res: Response) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers, text };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function cleanupTracked(db: ReturnType<typeof getV1Db>) {
  if (trackedUserIds.length === 0) return;
  const famRows = await db
    .select({ id: families.id })
    .from(families)
    .where(inArray(families.createdByUserId, trackedUserIds));
  for (const { id: fid } of famRows) {
    await db.execute(
      sql`DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE family_id = ${fid})`
    );
    await db.execute(sql`DELETE FROM claims WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM evidence WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM relationships WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM persons WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM media_objects WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM family_versions WHERE family_id = ${fid}`);
    await db.execute(sql`DELETE FROM audit_events WHERE family_id = ${fid}`);
    await db.execute(
      sql`DELETE FROM family_memberships WHERE family_id = ${fid}`
    );
    await db.execute(sql`DELETE FROM families WHERE id = ${fid}`);
  }
  await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
  await db.delete(users).where(inArray(users.id, trackedUserIds));
}

async function main() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1 DB / Auth not configured");
    process.exit(2);
  }

  process.env.V1_ALLOWED_ORIGINS =
    "https://cloud-family.vercel.app,http://localhost:3000";
  process.env.V1_ALPHA_APP_ENABLED = "true";

  const db = getV1Db();

  try {
    const ownerId = randomUUID();
    await insertUser(db, ownerId);
    const cookie = await sessionCookie(ownerId);

    const created = await readJson(
      await familiesRoot.POST(
        makeReq("POST", "/api/v1/families", {
          cookie,
          body: { displayName: "AgentChannelSmoke" },
        })
      )
    );
    const familyId = String(asObj(asObj(created.body).family).id ?? "");
    if (created.status !== 201 || !familyId) {
      fail("create_family", `status=${created.status}`);
      throw new Error("no family");
    }
    pass("create_family", familyId.slice(0, 8));

    const agentGet = await readJson(
      await agentRoute.GET(
        makeReq("GET", `/api/v1/families/${familyId}/agent`, { cookie }),
        { params: { familyId } }
      )
    );
    const agent = asObj(asObj(agentGet.body).agent ?? agentGet.body);
    const caps = Array.isArray(agent.capabilities)
      ? (agent.capabilities as Array<{ id: string }>)
      : [];
    const capIds = new Set(caps.map((c) => c.id));
    const needCaps = [
      "propose_package",
      "prefer_claim",
      "restore_person",
      "create_media_upload_intent",
      "list_evidence",
    ];
    if (
      agentGet.status === 200 &&
      Array.isArray(agent.playbook) &&
      needCaps.every((id) => capIds.has(id))
    ) {
      pass("agent_catalog", `caps=${caps.length}`);
    } else {
      fail(
        "agent_catalog",
        `status=${agentGet.status} missing=${needCaps
          .filter((id) => !capIds.has(id))
          .join(",")}`
      );
    }

    const proposeBody = {
      originType: "AI_EXTRACTION",
      persons: [
        {
          preferredName: "谱烟测",
          gender: "UNKNOWN",
          livingStatus: "UNKNOWN",
          clientItemId: "p1",
        },
      ],
      claims: [
        {
          subjectClientItemId: "p1",
          claimType: "OCCUPATION",
          value: { text: "教书" },
          confidence: 0.8,
        },
      ],
      evidence: {
        evidenceType: "DOCUMENT",
        title: "测试谱页",
        description: "agent-channel-smoke",
      },
    };
    const idem = `agent-smoke-${randomUUID()}`;
    const propose1 = await readJson(
      await proposeRoute.POST(
        makeReq("POST", `/api/v1/families/${familyId}/agent/propose`, {
          cookie,
          body: proposeBody,
          headers: {
            "Idempotency-Key": idem,
            "X-Client-Agent": "cursor-smoke",
          },
        }),
        { params: { familyId } }
      )
    );
    const propose2 = await readJson(
      await proposeRoute.POST(
        makeReq("POST", `/api/v1/families/${familyId}/agent/propose`, {
          cookie,
          body: proposeBody,
          headers: {
            "Idempotency-Key": idem,
            "X-Client-Agent": "cursor-smoke",
          },
        }),
        { params: { familyId } }
      )
    );
    const p1 = asObj(propose1.body);
    const claimsBlock = asObj(p1.claims);
    const claimResults = Array.isArray(claimsBlock.results)
      ? (claimsBlock.results as Array<Record<string, unknown>>)
      : [];
    const claimId = String(asObj(claimResults[0]?.claim).id ?? "");
    const personsBlock = asObj(p1.persons);
    const personResults = Array.isArray(personsBlock.results)
      ? (personsBlock.results as Array<Record<string, unknown>>)
      : [];
    const personId = String(asObj(personResults[0]?.person).id ?? "");
    // Fallback via personMap / claimMap if results shape differs
    const personMap = asObj(p1.personMap);
    const claimMap = asObj(p1.claimMap);
    const personIdFinal =
      personId || String(personMap.p1 ?? Object.values(personMap)[0] ?? "");
    const claimIdFinal =
      claimId || String(Object.values(claimMap)[0] ?? "");
    const replayed = propose2.headers.get("Idempotency-Replayed") === "true";
    if (
      propose1.status === 201 &&
      propose2.status === 201 &&
      replayed &&
      claimIdFinal &&
      personIdFinal
    ) {
      pass("propose_idempotent", `claim=${claimIdFinal.slice(0, 8)}`);
    } else {
      fail(
        "propose_idempotent",
        `s1=${propose1.status} s2=${propose2.status} replay=${replayed} claim=${!!claimIdFinal} body=${propose1.text.slice(0, 200)}`
      );
    }

    const overview = await readJson(
      await overviewRoute.GET(
        makeReq("GET", `/api/v1/families/${familyId}/overview`, { cookie }),
        { params: { familyId } }
      )
    );
    const ov = asObj(asObj(overview.body).overview);
    if (overview.status === 200 && Number(ov.pendingTotal ?? 0) >= 1) {
      pass("overview_pending", `pending=${ov.pendingTotal}`);
    } else {
      fail("overview_pending", `status=${overview.status}`);
    }

    const reviewKey = `review-${randomUUID()}`;
    const review = await readJson(
      await reviewBatchRoute.POST(
        makeReq("POST", `/api/v1/families/${familyId}/claims/review-batch`, {
          cookie,
          body: { action: "accept", claimIds: [claimIdFinal] },
          headers: { "Idempotency-Key": reviewKey },
        }),
        { params: { familyId } }
      )
    );
    const reviewBody = asObj(review.body);
    if (review.status === 200 && Number(reviewBody.succeeded ?? 0) >= 1) {
      pass("review_batch_accept", `succeeded=${reviewBody.succeeded}`);
    } else {
      fail(
        "review_batch_accept",
        `status=${review.status} body=${review.text.slice(0, 200)}`
      );
    }

    const evList = await readJson(
      await evidenceRoute.GET(
        makeReq("GET", `/api/v1/families/${familyId}/evidence?limit=20`, {
          cookie,
        }),
        { params: { familyId } }
      )
    );
    const evidence = Array.isArray(asObj(evList.body).evidence)
      ? (asObj(evList.body).evidence as Array<Record<string, unknown>>)
      : [];
    const withLinks = evidence.find((e) => Number(e.linkCount ?? 0) >= 1);
    if (evList.status === 200 && withLinks) {
      pass("evidence_link_count", `linkCount=${withLinks.linkCount}`);
    } else {
      fail(
        "evidence_link_count",
        `status=${evList.status} n=${evidence.length}`
      );
    }

    const delKey = `del-${randomUUID()}`;
    const del = await readJson(
      await personIdRoute.DELETE(
        makeReq(
          "DELETE",
          `/api/v1/families/${familyId}/persons/${personIdFinal}`,
          {
            cookie,
            body: {},
            headers: { "Idempotency-Key": delKey },
          }
        ),
        { params: { familyId, personId: personIdFinal } }
      )
    );
    const restKey = `rest-${randomUUID()}`;
    const rest = await readJson(
      await personRestoreRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/persons/${personIdFinal}/restore`,
          {
            cookie,
            body: {},
            headers: { "Idempotency-Key": restKey },
          }
        ),
        { params: { familyId, personId: personIdFinal } }
      )
    );
    const rest2 = await readJson(
      await personRestoreRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/persons/${personIdFinal}/restore`,
          {
            cookie,
            body: {},
            headers: { "Idempotency-Key": restKey },
          }
        ),
        { params: { familyId, personId: personIdFinal } }
      )
    );
    if (
      del.status === 200 &&
      rest.status === 200 &&
      rest2.status === 200 &&
      rest2.headers.get("Idempotency-Replayed") === "true"
    ) {
      pass("soft_delete_restore_idempotent");
    } else {
      fail(
        "soft_delete_restore_idempotent",
        `del=${del.status} rest=${rest.status} rest2=${rest2.status} replay=${rest2.headers.get("Idempotency-Replayed")}`
      );
    }

    // silence unused imports if tree-shaken oddly
    void claims;
    void claimEvidence;
  } catch (e) {
    fail("fatal", e instanceof Error ? e.message : String(e));
  } finally {
    try {
      await cleanupTracked(db);
      pass("cleanup");
    } catch (e) {
      fail("cleanup", e instanceof Error ? e.message : String(e));
    }
    await closeV1Db().catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nAgent channel smoke: ${results.length - failed.length}/${results.length} passed`
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
