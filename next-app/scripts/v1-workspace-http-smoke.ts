/**
 * CF-V1-API-001 Workspace HTTP smoke — Closed Alpha Family Workspace JSON API.
 * Invokes real Next route handlers with real V1 sessions (cookie → resolveSession).
 * All synthetic data; full cleanup; Production gate left false.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  sessions,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  persons,
  relationships,
  claims,
  evidence,
  claimEvidence,
  mediaObjects,
  alphaInvites,
  authChallenges,
} from "../src/db/schema";
import { isV1AuthConfigured } from "../src/v1/domain/auth/config";
import { createSession } from "../src/v1/services/authService";
import { V1_SESSION_COOKIE_NAME } from "../src/v1/domain/auth/types";
import type { MembershipRole } from "../src/db/constants";

import * as familiesRoot from "../src/app/api/v1/families/route";
import * as familyIdRoute from "../src/app/api/v1/families/[familyId]/route";
import * as graphRoute from "../src/app/api/v1/families/[familyId]/graph/route";
import * as personsRoute from "../src/app/api/v1/families/[familyId]/persons/route";
import * as personIdRoute from "../src/app/api/v1/families/[familyId]/persons/[personId]/route";
import * as relsRoute from "../src/app/api/v1/families/[familyId]/relationships/route";
import * as relIdRoute from "../src/app/api/v1/families/[familyId]/relationships/[relationshipId]/route";
import * as claimsRoute from "../src/app/api/v1/families/[familyId]/claims/route";
import * as claimIdRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/route";
import * as acceptRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/accept/route";
import * as rejectRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/reject/route";
import * as claimEvRoute from "../src/app/api/v1/families/[familyId]/claims/[claimId]/evidence/route";
import * as evidenceRoute from "../src/app/api/v1/families/[familyId]/evidence/route";
import * as evidenceIdRoute from "../src/app/api/v1/families/[familyId]/evidence/[evidenceId]/route";

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
const FORBIDDEN_KEYS = [
  "email_lookup_hash",
  "email_ciphertext",
  "token_hash",
  "storage_key",
  "value_fingerprint",
  "created_by_user_id",
];

const trackedUserIds: string[] = [];

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  trackedUserIds.push(id);
}

async function insertMember(
  db: ReturnType<typeof getV1Db>,
  familyId: string,
  userId: string,
  role: MembershipRole,
  status: "ACTIVE" | "SUSPENDED" = "ACTIVE"
) {
  const now = new Date();
  await db.insert(familyMemberships).values({
    id: randomUUID(),
    familyId,
    userId,
    role,
    status,
    createdAt: now,
    updatedAt: now,
  });
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
    origin?: string | null;
    body?: unknown;
    contentType?: string | null;
  } = {}
): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.origin !== null && opts.origin !== undefined) {
    headers.set("origin", opts.origin);
  } else if (opts.origin === undefined && method !== "GET") {
    headers.set("origin", ORIGIN_OK);
  }
  if (opts.body !== undefined) {
    if (opts.contentType !== null) {
      headers.set(
        "content-type",
        opts.contentType ?? "application/json"
      );
    }
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
}

async function readJson(res: Response): Promise<{
  status: number;
  body: unknown;
  headers: Headers;
  text: string;
}> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers, text };
}

function assertCleanResponse(name: string, text: string): boolean {
  for (const k of FORBIDDEN_KEYS) {
    if (text.includes(k)) {
      fail(name, `leaked field ${k}`);
      return false;
    }
  }
  return true;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function countTable(
  db: ReturnType<typeof getV1Db>,
  table: string
): Promise<number> {
  const r = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS c FROM ${table}`)
  );
  const row = (r as unknown as { rows?: { c: number }[] }).rows?.[0];
  return row?.c ?? Number((r as unknown as { c: number }[])[0]?.c ?? 0);
}

async function cleanupTracked(db: ReturnType<typeof getV1Db>) {
  if (trackedUserIds.length === 0) return;
  // Cascade-ish: delete by family ownership of tracked users, then users
  const famRows = await db
    .select({ id: families.id })
    .from(families)
    .where(inArray(families.createdByUserId, trackedUserIds));
  const famIds = famRows.map((f) => f.id);
  if (famIds.length) {
    await db
      .delete(claimEvidence)
      .where(
        inArray(
          claimEvidence.claimId,
          db
            .select({ id: claims.id })
            .from(claims)
            .where(inArray(claims.familyId, famIds))
        )
      )
      .catch(() => undefined);
    // Simpler raw deletes by family
    for (const fid of famIds) {
      await db.execute(
        sql`DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE family_id = ${fid})`
      );
      await db.execute(sql`DELETE FROM claims WHERE family_id = ${fid}`);
      await db.execute(sql`DELETE FROM evidence WHERE family_id = ${fid}`);
      await db.execute(
        sql`DELETE FROM relationships WHERE family_id = ${fid}`
      );
      await db.execute(sql`DELETE FROM persons WHERE family_id = ${fid}`);
      await db.execute(
        sql`DELETE FROM media_objects WHERE family_id = ${fid}`
      );
      await db.execute(
        sql`DELETE FROM family_versions WHERE family_id = ${fid}`
      );
      await db.execute(
        sql`DELETE FROM audit_events WHERE family_id = ${fid}`
      );
      await db.execute(
        sql`DELETE FROM family_memberships WHERE family_id = ${fid}`
      );
      await db.execute(sql`DELETE FROM families WHERE id = ${fid}`);
    }
  }
  await db
    .delete(sessions)
    .where(inArray(sessions.userId, trackedUserIds));
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
    // —— Feature gate OFF ——
    process.env.V1_ALPHA_APP_ENABLED = "false";
    {
      const cookie = await (async () => {
        const id = randomUUID();
        await insertUser(db, id);
        return sessionCookie(id);
      })();
      const res = await readJson(
        await familiesRoot.POST(
          makeReq("POST", "/api/v1/families", {
            cookie,
            body: { displayName: "GateOff" },
          })
        )
      );
      if (res.status === 404) pass("feature_gate_off", "404");
      else fail("feature_gate_off", `status=${res.status}`);
    }
    process.env.V1_ALPHA_APP_ENABLED = "true";

    // —— Unauthenticated ——
    {
      const res = await readJson(
        await familiesRoot.GET(makeReq("GET", "/api/v1/families", {}))
      );
      if (res.status === 401) pass("unauthenticated_401");
      else fail("unauthenticated_401", `status=${res.status}`);
    }

    // —— FLOW A Owner Workspace ——
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const editorId = randomUUID();
    const unrelatedId = randomUUID();
    await insertUser(db, ownerId);
    await insertUser(db, viewerId);
    await insertUser(db, editorId);
    await insertUser(db, unrelatedId);

    const ownerCookie = await sessionCookie(ownerId);
    const viewerCookie = await sessionCookie(viewerId);
    const editorCookie = await sessionCookie(editorId);
    const unrelatedCookie = await sessionCookie(unrelatedId);

    let familyId = "";
    let personA = "";
    let personB = "";
    let claimId = "";
    let evidenceId = "";
    let versionAfterCreate = 0;

    // Mass-assignment on create must be rejected (strict schema)
    {
      const bad = await readJson(
        await familiesRoot.POST(
          makeReq("POST", "/api/v1/families", {
            cookie: ownerCookie,
            body: {
              displayName: "Should Fail",
              actorUserId: unrelatedId,
              ownerUserId: unrelatedId,
              role: "VIEWER",
            },
          })
        )
      );
      if (bad.status === 400) pass("mass_assignment_create_rejected");
      else fail("mass_assignment_create_rejected", `status=${bad.status}`);
    }

    // Create family (default private); actor spoof fields ignored only if absent
    {
      const res = await readJson(
        await familiesRoot.POST(
          makeReq("POST", "/api/v1/families", {
            cookie: ownerCookie,
            body: {
              displayName: "Workspace Smoke Family",
            },
          })
        )
      );
      const fam = asObj(asObj(res.body).family);
      if (
        res.status === 201 &&
        fam.visibility === "PRIVATE" &&
        fam.discoveryEnabled === false &&
        typeof fam.id === "string"
      ) {
        familyId = fam.id as string;
        versionAfterCreate = Number(fam.currentVersionNo);
        pass("family_create_http", `v=${versionAfterCreate}`);
      } else {
        fail("family_create_http", `status=${res.status} body=${res.text}`);
      }
      assertCleanResponse("family_create_clean", res.text);
    }

    if (!familyId) {
      fail("fatal", "no familyId; aborting remaining flows");
      throw new Error("no familyId");
    }

    // List
    {
      const res = await readJson(
        await familiesRoot.GET(
          makeReq("GET", "/api/v1/families", { cookie: ownerCookie })
        )
      );
      const list = (asObj(res.body).families as unknown[]) ?? [];
      const hit = list.find(
        (x) => asObj(x).id === familyId && asObj(x).role === "OWNER"
      );
      const cc = res.headers.get("Cache-Control");
      if (res.status === 200 && hit && cc === "private, no-store") {
        pass("family_list_http", "OWNER + no-store");
      } else {
        fail(
          "family_list_http",
          `status=${res.status} cc=${cc} hit=${!!hit}`
        );
      }
    }

    // Suspended membership not listed
    {
      await insertMember(db, familyId, viewerId, "VIEWER", "SUSPENDED");
      const res = await readJson(
        await familiesRoot.GET(
          makeReq("GET", "/api/v1/families", { cookie: viewerCookie })
        )
      );
      const list = (asObj(res.body).families as unknown[]) ?? [];
      const hit = list.find((x) => asObj(x).id === familyId);
      if (!hit) pass("suspended_not_listed");
      else fail("suspended_not_listed", "suspended family appeared");
      // upgrade to ACTIVE VIEWER for later tests
      await db
        .update(familyMemberships)
        .set({ status: "ACTIVE", updatedAt: new Date() })
        .where(
          sql`${familyMemberships.familyId} = ${familyId} AND ${familyMemberships.userId} = ${viewerId}`
        );
      await insertMember(db, familyId, editorId, "EDITOR");
    }

    // GET family
    {
      const res = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
          }),
          { params: { familyId } }
        )
      );
      if (res.status === 200 && asObj(asObj(res.body).family).id === familyId) {
        pass("family_get_http");
      } else fail("family_get_http", `status=${res.status}`);
    }

    // Persons A/B
    {
      const a = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: {
              preferredName: "PersonA",
              gender: "UNKNOWN",
              livingStatus: "UNKNOWN",
              privacyLevel: "INHERIT",
            },
          }),
          { params: { familyId } }
        )
      );
      const b = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "PersonB" },
          }),
          { params: { familyId } }
        )
      );
      personA = asObj(asObj(a.body).person).id as string;
      personB = asObj(asObj(b.body).person).id as string;
      if (a.status === 201 && b.status === 201 && personA && personB) {
        pass("person_create_http", `rev=${asObj(asObj(a.body).person).revisionNo}`);
      } else fail("person_create_http", `a=${a.status} b=${b.status}`);
    }

    // Parent relationship A→B
    {
      const res = await readJson(
        await relsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/relationships`, {
            cookie: ownerCookie,
            body: {
              fromPersonId: personA,
              toPersonId: personB,
              relationshipType: "BIOLOGICAL_PARENT",
            },
          }),
          { params: { familyId } }
        )
      );
      const rel = asObj(asObj(res.body).relationship);
      if (
        res.status === 201 &&
        rel.fromPersonId === personA &&
        rel.toPersonId === personB
      ) {
        pass("relationship_create_http", "parent direction");
      } else fail("relationship_create_http", `status=${res.status}`);
    }

    // Graph
    {
      const res = await readJson(
        await graphRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/graph`, {
            cookie: ownerCookie,
          }),
          { params: { familyId } }
        )
      );
      const g = asObj(asObj(res.body).graph);
      const personsList = (g.persons as unknown[]) ?? [];
      if (res.status === 200 && personsList.length >= 2) {
        pass("graph_get_http");
      } else fail("graph_get_http", `status=${res.status}`);
    }

    // Claim + Evidence + link + accept + get bundle
    {
      const c = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: ownerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: personA,
              claimType: "BIRTH_DATE",
              value: { text: "民国十三年" },
              originType: "MANUAL",
              status: "ACCEPTED",
              valueFingerprint: "evil",
              normalizedJson: {},
            },
          }),
          { params: { familyId } }
        )
      );
      // status/fingerprint should be rejected by strict schema
      if (c.status === 400) {
        pass("claim_forbidden_fields_rejected");
      } else {
        fail("claim_forbidden_fields_rejected", `status=${c.status}`);
      }

      const c2 = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: ownerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: personA,
              claimType: "BIRTH_DATE",
              value: { text: "民国十三年" },
              originType: "MANUAL",
            },
          }),
          { params: { familyId } }
        )
      );
      claimId = asObj(asObj(c2.body).claim).id as string;
      if (c2.status === 201 && claimId) pass("claim_create_http");
      else fail("claim_create_http", `status=${c2.status} ${c2.text}`);

      const ai = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: ownerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: personA,
              claimType: "COURTESY_NAME",
              value: { text: "x" },
              originType: "AI_EXTRACTION",
            },
          }),
          { params: { familyId } }
        )
      );
      if (ai.status === 400) pass("ai_origin_rejected");
      else fail("ai_origin_rejected", `status=${ai.status}`);

      const ev = await readJson(
        await evidenceRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/evidence`, {
            cookie: ownerCookie,
            body: {
              evidenceType: "ORAL_HISTORY",
              title: "口述",
              description: "祖辈口述",
              visibility: "FAMILY",
              mediaObjectId: null,
              storageKey: "evil/key",
            },
          }),
          { params: { familyId } }
        )
      );
      if (ev.status === 400) pass("storage_key_rejected");
      else fail("storage_key_rejected", `status=${ev.status}`);

      const ev2 = await readJson(
        await evidenceRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/evidence`, {
            cookie: ownerCookie,
            body: {
              evidenceType: "ORAL_HISTORY",
              title: "口述",
              description: "祖辈口述",
              visibility: "FAMILY",
            },
          }),
          { params: { familyId } }
        )
      );
      evidenceId = asObj(asObj(ev2.body).evidence).id as string;
      if (ev2.status === 201 && evidenceId) pass("evidence_create_http");
      else fail("evidence_create_http", `status=${ev2.status}`);

      const link = await readJson(
        await claimEvRoute.POST(
          makeReq(
            "POST",
            `/api/v1/families/${familyId}/claims/${claimId}/evidence`,
            {
              cookie: ownerCookie,
              body: { evidenceId, relation: "SUPPORTS" },
            }
          ),
          { params: { familyId, claimId } }
        )
      );
      if (link.status === 200) pass("evidence_link_http");
      else fail("evidence_link_http", `status=${link.status}`);

      const acc = await readJson(
        await acceptRoute.POST(
          makeReq(
            "POST",
            `/api/v1/families/${familyId}/claims/${claimId}/accept`,
            { cookie: ownerCookie, body: {} }
          ),
          { params: { familyId, claimId } }
        )
      );
      if (
        acc.status === 200 &&
        asObj(asObj(acc.body).claim).status === "ACCEPTED"
      ) {
        pass("claim_accept_http");
      } else fail("claim_accept_http", `status=${acc.status}`);

      const getC = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${claimId}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, claimId } }
        )
      );
      const links = (asObj(getC.body).evidenceLinks as unknown[]) ?? [];
      if (getC.status === 200 && links.length === 1) {
        pass("claim_get_bundle_http");
      } else fail("claim_get_bundle_http", `status=${getC.status}`);
      assertCleanResponse("owner_flow_clean", getC.text);
    }

    // FLOW B — stable family id + version monotonic
    {
      const get = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
          }),
          { params: { familyId } }
        )
      );
      const v = Number(asObj(asObj(get.body).family).currentVersionNo);
      if (asObj(asObj(get.body).family).id === familyId && v > versionAfterCreate) {
        pass("family_stability", `version ${versionAfterCreate}→${v}`);
      } else {
        fail("family_stability", `id/version check failed v=${v}`);
      }
    }

    // FLOW C — Viewer
    {
      const get = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: viewerCookie,
          }),
          { params: { familyId } }
        )
      );
      const graph = await readJson(
        await graphRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/graph`, {
            cookie: viewerCookie,
          }),
          { params: { familyId } }
        )
      );
      const createP = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: viewerCookie,
            body: { preferredName: "Nope" },
          }),
          { params: { familyId } }
        )
      );
      const createC = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: viewerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: personA,
              claimType: "ALIAS",
              value: { text: "x" },
            },
          }),
          { params: { familyId } }
        )
      );
      const createE = await readJson(
        await evidenceRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/evidence`, {
            cookie: viewerCookie,
            body: { evidenceType: "OTHER", title: "x" },
          }),
          { params: { familyId } }
        )
      );
      const patchF = await readJson(
        await familyIdRoute.PATCH(
          makeReq("PATCH", `/api/v1/families/${familyId}`, {
            cookie: viewerCookie,
            body: { expectedVersion: 1, displayName: "Hacked" },
          }),
          { params: { familyId } }
        )
      );
      if (
        get.status === 200 &&
        graph.status === 200 &&
        createP.status === 403 &&
        createC.status === 403 &&
        createE.status === 403 &&
        patchF.status === 403
      ) {
        pass("viewer_forbidden_mutations");
      } else {
        fail(
          "viewer_forbidden_mutations",
          `get=${get.status} g=${graph.status} p=${createP.status} c=${createC.status} e=${createE.status} f=${patchF.status}`
        );
      }
    }

    // FLOW D — Unrelated 404
    {
      const get = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: unrelatedCookie,
          }),
          { params: { familyId } }
        )
      );
      const person = await readJson(
        await personIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/persons/${personA}`,
            { cookie: unrelatedCookie }
          ),
          { params: { familyId, personId: personA } }
        )
      );
      const graph = await readJson(
        await graphRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/graph`, {
            cookie: unrelatedCookie,
          }),
          { params: { familyId } }
        )
      );
      const claim = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${claimId}`,
            { cookie: unrelatedCookie }
          ),
          { params: { familyId, claimId } }
        )
      );
      if (
        get.status === 404 &&
        person.status === 404 &&
        graph.status === 404 &&
        claim.status === 404
      ) {
        pass("unrelated_404");
      } else {
        fail(
          "unrelated_404",
          `f=${get.status} p=${person.status} g=${graph.status} c=${claim.status}`
        );
      }
    }

    // FLOW E — Private person (EDITOR)
    {
      const getP = await readJson(
        await personIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/persons/${personA}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, personId: personA } }
        )
      );
      const rev = Number(asObj(asObj(getP.body).person).revisionNo);
      await personIdRoute.PATCH(
        makeReq(
          "PATCH",
          `/api/v1/families/${familyId}/persons/${personA}`,
          {
            cookie: ownerCookie,
            body: { expectedRevision: rev, privacyLevel: "PRIVATE" },
          }
        ),
        { params: { familyId, personId: personA } }
      );

      const edGet = await readJson(
        await personIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/persons/${personA}`,
            { cookie: editorCookie }
          ),
          { params: { familyId, personId: personA } }
        )
      );
      const edClaim = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${claimId}`,
            { cookie: editorCookie }
          ),
          { params: { familyId, claimId } }
        )
      );
      const edGraph = await readJson(
        await graphRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/graph`, {
            cookie: editorCookie,
          }),
          { params: { familyId } }
        )
      );
      const gPersons = ((asObj(asObj(edGraph.body).graph).persons as unknown[]) ??
        []).map((p) => asObj(p).id);
      const gRels = (asObj(asObj(edGraph.body).graph).relationships as unknown[]) ??
        [];
      const leak =
        gPersons.includes(personA) ||
        JSON.stringify(gRels).includes(personA);
      if (edGet.status === 404 && edClaim.status === 404 && !leak) {
        pass("private_person_hidden");
      } else {
        fail(
          "private_person_hidden",
          `get=${edGet.status} claim=${edClaim.status} leak=${leak}`
        );
      }

      // restore for remaining tests
      const ownerGet = await readJson(
        await personIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/persons/${personA}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, personId: personA } }
        )
      );
      const rev2 = Number(asObj(asObj(ownerGet.body).person).revisionNo);
      await personIdRoute.PATCH(
        makeReq(
          "PATCH",
          `/api/v1/families/${familyId}/persons/${personA}`,
          {
            cookie: ownerCookie,
            body: { expectedRevision: rev2, privacyLevel: "FAMILY" },
          }
        ),
        { params: { familyId, personId: personA } }
      );
    }

    // FLOW F — Origin
    {
      const evil = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            origin: "https://evil.example",
            body: { preferredName: "Evil" },
          }),
          { params: { familyId } }
        )
      );
      const missing = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            origin: null,
            body: { preferredName: "NoOrigin" },
          }),
          { params: { familyId } }
        )
      );
      const ok = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            origin: ORIGIN_OK,
            body: { preferredName: "OkOrigin" },
          }),
          { params: { familyId } }
        )
      );
      const getNoOrigin = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
            origin: null,
          }),
          { params: { familyId } }
        )
      );
      if (
        evil.status === 403 &&
        missing.status === 403 &&
        ok.status === 201 &&
        getNoOrigin.status === 200
      ) {
        pass("origin_guard");
      } else {
        fail(
          "origin_guard",
          `evil=${evil.status} miss=${missing.status} ok=${ok.status} get=${getNoOrigin.status}`
        );
      }
    }

    // FLOW G — Mass assignment / actor spoof already partly covered
    {
      const get = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
          }),
          { params: { familyId } }
        )
      );
      const v = Number(asObj(asObj(get.body).family).currentVersionNo);
      const patch = await readJson(
        await familyIdRoute.PATCH(
          makeReq("PATCH", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
            body: {
              expectedVersion: v,
              displayName: "Renamed",
              id: randomUUID(),
              createdByUserId: unrelatedId,
              role: "VIEWER",
              currentVersionNo: 999,
            },
          }),
          { params: { familyId } }
        )
      );
      // strict schema → 400
      if (patch.status === 400) pass("mass_assignment_family");
      else fail("mass_assignment_family", `status=${patch.status}`);
    }

    // FLOW H — Person concurrency
    {
      // create fresh person
      const created = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "Concurrent" },
          }),
          { params: { familyId } }
        )
      );
      const pid = asObj(asObj(created.body).person).id as string;
      const rev = Number(asObj(asObj(created.body).person).revisionNo);
      const [r1, r2] = await Promise.all([
        personIdRoute.PATCH(
          makeReq(
            "PATCH",
            `/api/v1/families/${familyId}/persons/${pid}`,
            {
              cookie: ownerCookie,
              body: { expectedRevision: rev, preferredName: "C1" },
            }
          ),
          { params: { familyId, personId: pid } }
        ),
        personIdRoute.PATCH(
          makeReq(
            "PATCH",
            `/api/v1/families/${familyId}/persons/${pid}`,
            {
              cookie: ownerCookie,
              body: { expectedRevision: rev, preferredName: "C2" },
            }
          ),
          { params: { familyId, personId: pid } }
        ),
      ]);
      const s1 = (await readJson(r1)).status;
      const s2 = (await readJson(r2)).status;
      const statuses = [s1, s2].sort();
      if (statuses[0] === 200 && statuses[1] === 409) {
        pass("person_concurrency");
      } else fail("person_concurrency", `statuses=${s1},${s2}`);
    }

    // Family concurrency
    {
      const get = await readJson(
        await familyIdRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
          }),
          { params: { familyId } }
        )
      );
      const v = Number(asObj(asObj(get.body).family).currentVersionNo);
      const [r1, r2] = await Promise.all([
        familyIdRoute.PATCH(
          makeReq("PATCH", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
            body: { expectedVersion: v, displayName: "V1" },
          }),
          { params: { familyId } }
        ),
        familyIdRoute.PATCH(
          makeReq("PATCH", `/api/v1/families/${familyId}`, {
            cookie: ownerCookie,
            body: { expectedVersion: v, displayName: "V2" },
          }),
          { params: { familyId } }
        ),
      ]);
      const a = await readJson(r1);
      const b = await readJson(r2);
      const statuses = [a.status, b.status].sort();
      const codes = [asObj(a.body).code, asObj(b.body).code];
      if (
        statuses[0] === 200 &&
        statuses[1] === 409 &&
        codes.includes("VERSION_CONFLICT")
      ) {
        pass("family_concurrency");
      } else {
        fail("family_concurrency", `s=${a.status},${b.status}`);
      }
    }

    // FLOW I — Cycle
    {
      const pC = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "CycleC" },
          }),
          { params: { familyId } }
        )
      );
      const personC = asObj(asObj(pC.body).person).id as string;
      // A→B already exists; B→C; then C→A should cycle
      await relsRoute.POST(
        makeReq("POST", `/api/v1/families/${familyId}/relationships`, {
          cookie: ownerCookie,
          body: {
            fromPersonId: personB,
            toPersonId: personC,
            relationshipType: "BIOLOGICAL_PARENT",
          },
        }),
        { params: { familyId } }
      );
      const cycle = await readJson(
        await relsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/relationships`, {
            cookie: ownerCookie,
            body: {
              fromPersonId: personC,
              toPersonId: personA,
              relationshipType: "BIOLOGICAL_PARENT",
            },
          }),
          { params: { familyId } }
        )
      );
      if (
        cycle.status === 409 &&
        asObj(cycle.body).code === "ANCESTRY_CYCLE"
      ) {
        pass("graph_cycle_http");
      } else {
        fail("graph_cycle_http", `status=${cycle.status} ${cycle.text}`);
      }
    }

    // FLOW J — Claim conflict
    {
      const p = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "ConflictSubject" },
          }),
          { params: { familyId } }
        )
      );
      const sid = asObj(asObj(p.body).person).id as string;
      const c1923 = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: ownerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: sid,
              claimType: "BIRTH_DATE",
              value: { text: "1923" },
            },
          }),
          { params: { familyId } }
        )
      );
      const c1924 = await readJson(
        await claimsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/claims`, {
            cookie: ownerCookie,
            body: {
              subjectType: "PERSON",
              subjectId: sid,
              claimType: "BIRTH_DATE",
              value: { text: "1924" },
            },
          }),
          { params: { familyId } }
        )
      );
      const id23 = asObj(asObj(c1923.body).claim).id as string;
      const id24 = asObj(asObj(c1924.body).claim).id as string;
      await acceptRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/claims/${id23}/accept`,
          { cookie: ownerCookie, body: {} }
        ),
        { params: { familyId, claimId: id23 } }
      );
      await acceptRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/claims/${id24}/accept`,
          { cookie: ownerCookie, body: {} }
        ),
        { params: { familyId, claimId: id24 } }
      );
      const g23 = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${id23}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, claimId: id23 } }
        )
      );
      const g24 = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${id24}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, claimId: id24 } }
        )
      );
      const st23 = asObj(asObj(g23.body).claim).status;
      const st24 = asObj(asObj(g24.body).claim).status;
      await rejectRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/claims/${id24}/reject`,
          { cookie: ownerCookie, body: {} }
        ),
        { params: { familyId, claimId: id24 } }
      );
      // After reject of conflicted, recompute may restore ACCEPTED on 1923
      const g23b = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${id23}`,
            { cookie: ownerCookie }
          ),
          { params: { familyId, claimId: id23 } }
        )
      );
      if (
        st23 === "CONFLICTED" &&
        st24 === "CONFLICTED" &&
        asObj(asObj(g23b.body).claim).status === "ACCEPTED"
      ) {
        pass("claim_conflict_http");
      } else {
        fail(
          "claim_conflict_http",
          `st23=${st23} st24=${st24} after=${asObj(asObj(g23b.body).claim).status}`
        );
      }
    }

    // Evidence privacy — PRIVATE evidence hidden from Viewer
    {
      const privEv = await readJson(
        await evidenceRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/evidence`, {
            cookie: ownerCookie,
            body: {
              evidenceType: "DOCUMENT",
              title: "Private Doc",
              visibility: "PRIVATE",
            },
          }),
          { params: { familyId } }
        )
      );
      const peid = asObj(asObj(privEv.body).evidence).id as string;
      await claimEvRoute.POST(
        makeReq(
          "POST",
          `/api/v1/families/${familyId}/claims/${claimId}/evidence`,
          {
            cookie: ownerCookie,
            body: { evidenceId: peid, relation: "CONTEXT" },
          }
        ),
        { params: { familyId, claimId } }
      );
      const viewerBundle = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${familyId}/claims/${claimId}`,
            { cookie: viewerCookie }
          ),
          { params: { familyId, claimId } }
        )
      );
      const links =
        (asObj(viewerBundle.body).evidenceLinks as unknown[]) ?? [];
      const hasPrivate = links.some(
        (l) => asObj(asObj(l).evidence).id === peid
      );
      const hasHiddenCount = viewerBundle.text.includes("hiddenEvidenceCount");
      if (
        viewerBundle.status === 200 &&
        !hasPrivate &&
        !hasHiddenCount
      ) {
        pass("evidence_privacy_http");
      } else {
        fail(
          "evidence_privacy_http",
          `hasPrivate=${hasPrivate} hiddenCount=${hasHiddenCount}`
        );
      }
    }

    // Relationship side channel — private B
    {
      const vis = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "VisibleSide", privacyLevel: "FAMILY" },
          }),
          { params: { familyId } }
        )
      );
      const hid = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "HiddenSide", privacyLevel: "PRIVATE" },
          }),
          { params: { familyId } }
        )
      );
      const vid = asObj(asObj(vis.body).person).id as string;
      const hidId = asObj(asObj(hid.body).person).id as string;
      const rel = await readJson(
        await relsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/relationships`, {
            cookie: ownerCookie,
            body: {
              fromPersonId: vid,
              toPersonId: hidId,
              relationshipType: "BIOLOGICAL_PARENT",
            },
          }),
          { params: { familyId } }
        )
      );
      const rid = asObj(asObj(rel.body).relationship).id as string;
      const edGraph = await readJson(
        await graphRoute.GET(
          makeReq("GET", `/api/v1/families/${familyId}/graph`, {
            cookie: editorCookie,
          }),
          { params: { familyId } }
        )
      );
      const blob = edGraph.text;
      if (
        !blob.includes(hidId) &&
        !blob.includes(rid) &&
        blob.includes(vid)
      ) {
        pass("relationship_sidechannel");
      } else {
        fail(
          "relationship_sidechannel",
          `leak hidden or rel; hasVisible=${blob.includes(vid)}`
        );
      }
    }

    // Cross-family
    {
      const otherOwner = randomUUID();
      await insertUser(db, otherOwner);
      const otherCookie = await sessionCookie(otherOwner);
      const otherFam = await readJson(
        await familiesRoot.POST(
          makeReq("POST", "/api/v1/families", {
            cookie: otherCookie,
            body: { displayName: "Other Family" },
          })
        )
      );
      const otherFamilyId = asObj(asObj(otherFam.body).family).id as string;
      const crossP = await readJson(
        await personIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${otherFamilyId}/persons/${personA}`,
            { cookie: otherCookie }
          ),
          { params: { familyId: otherFamilyId, personId: personA } }
        )
      );
      const crossC = await readJson(
        await claimIdRoute.GET(
          makeReq(
            "GET",
            `/api/v1/families/${otherFamilyId}/claims/${claimId}`,
            { cookie: otherCookie }
          ),
          { params: { familyId: otherFamilyId, claimId } }
        )
      );
      const crossE = await readJson(
        await evidenceIdRoute.DELETE(
          makeReq(
            "DELETE",
            `/api/v1/families/${otherFamilyId}/evidence/${evidenceId}`,
            { cookie: otherCookie }
          ),
          { params: { familyId: otherFamilyId, evidenceId } }
        )
      );
      if (
        crossP.status === 404 &&
        crossC.status === 404 &&
        crossE.status === 404
      ) {
        pass("cross_family_blocked");
      } else {
        fail(
          "cross_family_blocked",
          `p=${crossP.status} c=${crossC.status} e=${crossE.status}`
        );
      }
    }

    // Content-Type
    {
      const res = await readJson(
        await familiesRoot.POST(
          makeReq("POST", "/api/v1/families", {
            cookie: ownerCookie,
            body: { displayName: "X" },
            contentType: "text/plain",
          })
        )
      );
      if (res.status === 415) pass("content_type_415");
      else fail("content_type_415", `status=${res.status}`);
    }

    // Soft delete person
    {
      const created = await readJson(
        await personsRoute.POST(
          makeReq("POST", `/api/v1/families/${familyId}/persons`, {
            cookie: ownerCookie,
            body: { preferredName: "ToDelete" },
          }),
          { params: { familyId } }
        )
      );
      const pid = asObj(asObj(created.body).person).id as string;
      const del = await readJson(
        await personIdRoute.DELETE(
          makeReq(
            "DELETE",
            `/api/v1/families/${familyId}/persons/${pid}`,
            {
              cookie: ownerCookie,
              body: { hard: true, cascade: true },
              contentType: null,
            }
          ),
          { params: { familyId, personId: pid } }
        )
      );
      // DELETE without JSON content-type is fine; hard/cascade ignored (no body parse)
      if (del.status === 200) pass("person_soft_delete_http");
      else fail("person_soft_delete_http", `status=${del.status}`);
    }

    // Cleanup
    await cleanupTracked(db);

    const tables: [string, string][] = [
      ["users", "users"],
      ["sessions", "sessions"],
      ["alpha_invites", "alpha_invites"],
      ["families", "families"],
      ["memberships", "family_memberships"],
      ["persons", "persons"],
      ["relationships", "relationships"],
      ["claims", "claims"],
      ["evidence", "evidence"],
      ["claim_evidence", "claim_evidence"],
      ["media_objects", "media_objects"],
      ["versions", "family_versions"],
      ["audits", "audit_events"],
    ];
    let cleanupOk = true;
    for (const [label, table] of tables) {
      const c = await countTable(db, table);
      if (c !== 0) {
        cleanupOk = false;
        fail("cleanup", `${label}=${c}`);
      }
    }
    if (cleanupOk) pass("cleanup", "all V1 tables 0");

    // Ensure gate restored false for process (does not touch Production)
    process.env.V1_ALPHA_APP_ENABLED = "false";
  } catch (e) {
    console.error(e);
    fail("fatal", e instanceof Error ? e.message : String(e));
    try {
      await cleanupTracked(db);
    } catch {
      /* ignore */
    }
  } finally {
    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n—— Summary ——");
  console.log(`PASS ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main();
