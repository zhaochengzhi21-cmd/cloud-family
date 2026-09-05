/**
 * V1 DB smoke + negative constraint tests.
 * Uses only synthetic IDs/names — no real PII.
 * Requires V1_DATABASE_URL. Cleans up all rows it creates.
 *
 * Never prints the connection string.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  families,
  familyMemberships,
  persons,
  relationships,
  claims,
  evidence,
  claimEvidence,
  familyVersions,
  auditEvents,
} from "../src/db/schema";

config({ path: ".env.local" });
config({ path: ".env.development.local" });
config({ path: ".env" });

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function pass(name: string, detail = "ok") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name} — ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}

function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
    depth += 1;
  }
  return parts.join(" | ");
}

async function expectFail(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    fail(name, "expected DB constraint error, but succeeded");
  } catch (e: unknown) {
    const msg = errorText(e);
    if (/check|unique|duplicate|violates|constraint|23505|23514/i.test(msg)) {
      pass(name, "constraint rejected as expected");
    } else {
      fail(name, `unexpected error: ${msg.slice(0, 300)}`);
    }
  }
}

async function main() {
  if (!isV1DbConfigured()) {
    console.error("V1_DATABASE_URL missing — cannot smoke test");
    process.exit(2);
  }

  const db = getV1Db();
  const now = new Date();
  const ids = {
    user: randomUUID(),
    family: randomUUID(),
    membership: randomUUID(),
    parent: randomUUID(),
    child: randomUUID(),
    rel: randomUUID(),
    claim: randomUUID(),
    evidence: randomUUID(),
    version: randomUUID(),
    audit: randomUUID(),
  };

  try {
    await db.insert(users).values({
      id: ids.user,
      emailLookupHash: null,
      emailCiphertext: null,
      emailKeyVersion: null,
      createdAt: now,
      updatedAt: now,
    });
    pass("fake_user", ids.user.slice(0, 8));

    await db.insert(families).values({
      id: ids.family,
      displayName: "Smoke Test Family",
      surname: "Test",
      visibility: "PRIVATE",
      discoveryEnabled: true,
      createdByUserId: ids.user,
      currentVersionNo: 0,
      createdAt: now,
      updatedAt: now,
    });
    pass("fake_family", "PRIVATE + discovery_enabled=true");

    await db.insert(familyMemberships).values({
      id: ids.membership,
      familyId: ids.family,
      userId: ids.user,
      role: "OWNER",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    pass("membership");

    await db.insert(persons).values([
      {
        id: ids.parent,
        familyId: ids.family,
        preferredName: "Parent A",
        gender: "UNKNOWN",
        livingStatus: "UNKNOWN",
        privacyLevel: "INHERIT",
        createdByUserId: ids.user,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.child,
        familyId: ids.family,
        preferredName: "Child B",
        gender: "UNKNOWN",
        livingStatus: "UNKNOWN",
        privacyLevel: "INHERIT",
        createdByUserId: ids.user,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    pass("persons", "parent+child");

    await db.insert(relationships).values({
      id: ids.rel,
      familyId: ids.family,
      fromPersonId: ids.parent,
      toPersonId: ids.child,
      relationshipType: "BIOLOGICAL_PARENT",
      status: "ACCEPTED",
      createdByUserId: ids.user,
      createdAt: now,
      updatedAt: now,
    });
    pass("relationship", "from=parent to=child");

    await db.insert(claims).values({
      id: ids.claim,
      familyId: ids.family,
      subjectType: "PERSON",
      subjectId: ids.parent,
      claimType: "ALIAS",
      valueJson: { alias: "SmokeAlias" },
      status: "PROPOSED",
      confidence: "0.500",
      createdByUserId: ids.user,
      createdAt: now,
      updatedAt: now,
    });
    pass("claim");

    await db.insert(evidence).values({
      id: ids.evidence,
      familyId: ids.family,
      evidenceType: "OTHER",
      title: "Synthetic evidence",
      description: null,
      createdByUserId: ids.user,
      createdAt: now,
      updatedAt: now,
    });
    pass("evidence");

    await db.insert(claimEvidence).values({
      claimId: ids.claim,
      evidenceId: ids.evidence,
      relation: "SUPPORTS",
      createdAt: now,
    });
    pass("claim_evidence");

    await db.insert(familyVersions).values({
      id: ids.version,
      familyId: ids.family,
      versionNo: 1,
      createdByUserId: ids.user,
      schemaVersion: 1,
      summary: "smoke v1",
      contentHash: null,
      snapshotJson: { note: "not source of truth" },
      createdAt: now,
    });
    pass("version");

    await db.insert(auditEvents).values({
      id: ids.audit,
      familyId: ids.family,
      actorUserId: ids.user,
      eventType: "SMOKE_TEST",
      entityType: "FAMILY",
      entityId: ids.family,
      metadataJson: { synthetic: true },
      createdAt: now,
    });
    pass("audit");

    const [familyRow] = await db
      .select()
      .from(families)
      .where(eq(families.id, ids.family));
    const [relRow] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, ids.rel));
    if (familyRow?.displayName === "Smoke Test Family" && relRow) {
      pass("read_back");
    } else {
      fail("read_back", "missing rows");
    }

    // Negative tests
    await expectFail("invalid_visibility", () =>
      db.insert(families).values({
        id: randomUUID(),
        displayName: "Bad Vis",
        visibility: "OPEN",
        discoveryEnabled: false,
        createdAt: now,
        updatedAt: now,
      })
    );

    await expectFail("self_relationship", () =>
      db.insert(relationships).values({
        id: randomUUID(),
        familyId: ids.family,
        fromPersonId: ids.parent,
        toPersonId: ids.parent,
        relationshipType: "SPOUSE",
        status: "ACCEPTED",
        createdAt: now,
        updatedAt: now,
      })
    );

    await expectFail("duplicate_membership", () =>
      db.insert(familyMemberships).values({
        id: randomUUID(),
        familyId: ids.family,
        userId: ids.user,
        role: "EDITOR",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
    );

    await expectFail("confidence_gt_1", () =>
      db.insert(claims).values({
        id: randomUUID(),
        familyId: ids.family,
        subjectType: "PERSON",
        subjectId: ids.child,
        claimType: "OCCUPATION",
        valueJson: { job: "x" },
        status: "PROPOSED",
        confidence: "1.500",
        createdAt: now,
        updatedAt: now,
      })
    );

    await expectFail("duplicate_version", () =>
      db.insert(familyVersions).values({
        id: randomUUID(),
        familyId: ids.family,
        versionNo: 1,
        schemaVersion: 1,
        createdAt: now,
      })
    );
  } finally {
    // Cleanup in FK-safe order
    await db.delete(claimEvidence).where(eq(claimEvidence.claimId, ids.claim));
    await db.delete(claims).where(eq(claims.familyId, ids.family));
    await db.delete(evidence).where(eq(evidence.familyId, ids.family));
    await db.delete(relationships).where(eq(relationships.familyId, ids.family));
    await db.delete(persons).where(eq(persons.familyId, ids.family));
    await db.delete(familyVersions).where(eq(familyVersions.familyId, ids.family));
    await db.delete(auditEvents).where(eq(auditEvents.familyId, ids.family));
    await db
      .delete(familyMemberships)
      .where(eq(familyMemberships.familyId, ids.family));
    await db.delete(families).where(eq(families.id, ids.family));
    await db.delete(users).where(eq(users.id, ids.user));

    const leftover = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE id = ${ids.user}) AS u,
        (SELECT count(*)::int FROM families WHERE id = ${ids.family}) AS f
    `);
    const row = leftover.rows[0] as { u: number; f: number } | undefined;
    if (row && Number(row.u) === 0 && Number(row.f) === 0) {
      pass("cleanup", "rows_left=0");
    } else {
      fail("cleanup", `leftover=${JSON.stringify(row)}`);
    }

    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify({
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      failed_names: failed.map((f) => f.name),
    })
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("SMOKE_FATAL", e instanceof Error ? e.message : e);
  try {
    await closeV1Db();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
