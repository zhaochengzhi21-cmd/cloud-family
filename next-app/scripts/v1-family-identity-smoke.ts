/**
 * Stable Family Identity smoke + concurrency tests.
 * Synthetic data only — cleans up completely.
 * Never prints V1_DATABASE_URL.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
} from "../src/db/schema";
import {
  createFamily,
  getFamilyById,
  updateFamilyIdentity,
} from "../src/v1/services/familyService";
import {
  isFamilyDomainError,
} from "../src/v1/domain/family/errors";
import * as repo from "../src/v1/repositories/familyRepository";

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

async function insertFakeUser(id: string) {
  const db = getV1Db();
  const now = new Date();
  await db.insert(users).values({
    id,
    emailLookupHash: null,
    emailCiphertext: null,
    emailKeyVersion: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function main() {
  if (!isV1DbConfigured()) {
    console.error("V1_DATABASE_URL missing");
    process.exit(2);
  }

  const db = getV1Db();
  const ownerId = randomUUID();
  const editorId = randomUUID();
  const trackedFamilyIds: string[] = [];
  const trackedUserIds = [ownerId, editorId];
  let familyIdOriginal = "";
  let currentVersion = 0;

  try {
    await insertFakeUser(ownerId);
    await insertFakeUser(editorId);

    // TEST 01 — Create
    {
      const { family } = await createFamily({
        ownerUserId: ownerId,
        displayName: "Identity Smoke Family",
        surname: "Smoke",
        visibility: "PRIVATE",
        discoveryEnabled: false,
      });
      familyIdOriginal = family.id;
      trackedFamilyIds.push(family.id);
      currentVersion = family.currentVersionNo;

      const membership = await repo.findActiveMembership(
        db,
        family.id,
        ownerId
      );
      const versionCount = await repo.countFamilyVersions(db, family.id);
      const auditCount = await repo.countAuditEvents(
        db,
        family.id,
        "FAMILY_CREATED"
      );

      if (
        family.currentVersionNo === 1 &&
        membership?.role === "OWNER" &&
        versionCount === 1 &&
        auditCount === 1
      ) {
        pass("create", `familyId=${family.id.slice(0, 8)}… v=1`);
      } else {
        fail(
          "create",
          `v=${family.currentVersionNo} m=${membership?.role} vers=${versionCount} audit=${auditCount}`
        );
      }
    }

    // TEST 02 — Update displayName
    {
      const res = await updateFamilyIdentity({
        familyId: familyIdOriginal,
        actorUserId: ownerId,
        expectedVersion: 1,
        displayName: "Identity Smoke Family Renamed",
      });
      if (
        res.status === "UPDATED" &&
        res.family.id === familyIdOriginal &&
        res.toVersion === 2 &&
        res.family.currentVersionNo === 2
      ) {
        const versions = await repo.countFamilyVersions(db, familyIdOriginal);
        if (versions === 2) {
          pass("update", "same id → v2; v1 retained");
          currentVersion = 2;
        } else {
          fail("update", `version rows=${versions}`);
        }
      } else {
        fail("update", JSON.stringify(res));
      }
    }

    // TEST 03 — Second update visibility PRIVATE → LINK
    {
      const res = await updateFamilyIdentity({
        familyId: familyIdOriginal,
        actorUserId: ownerId,
        expectedVersion: 2,
        visibility: "LINK",
      });
      if (
        res.status === "UPDATED" &&
        res.family.id === familyIdOriginal &&
        res.toVersion === 3 &&
        res.family.visibility === "LINK"
      ) {
        pass("second_update", "same id → v3 LINK");
        currentVersion = 3;
      } else {
        fail("second_update", JSON.stringify(res));
      }
    }

    // TEST 04 — discovery independence
    {
      const res = await updateFamilyIdentity({
        familyId: familyIdOriginal,
        actorUserId: ownerId,
        expectedVersion: 3,
        visibility: "PRIVATE",
        discoveryEnabled: true,
      });
      if (
        res.status === "UPDATED" &&
        res.family.visibility === "PRIVATE" &&
        res.family.discoveryEnabled === true &&
        res.toVersion === 4
      ) {
        pass("private_discovery", "PRIVATE + discoveryEnabled=true");
        currentVersion = 4;
      } else {
        fail("private_discovery", JSON.stringify(res));
      }
    }

    // TEST 05 — stale version
    {
      const beforeVersions = await repo.countFamilyVersions(
        db,
        familyIdOriginal
      );
      const beforeAudits = await repo.countAuditEvents(db, familyIdOriginal);
      const before = await getFamilyById(familyIdOriginal);
      try {
        await updateFamilyIdentity({
          familyId: familyIdOriginal,
          actorUserId: ownerId,
          expectedVersion: 3,
          displayName: "Should Not Apply",
        });
        fail("stale_version", "expected VERSION_CONFLICT");
      } catch (e) {
        const after = await getFamilyById(familyIdOriginal);
        const afterVersions = await repo.countFamilyVersions(
          db,
          familyIdOriginal
        );
        const afterAudits = await repo.countAuditEvents(db, familyIdOriginal);
        if (
          isFamilyDomainError(e) &&
          e.code === "VERSION_CONFLICT" &&
          after?.currentVersionNo === before?.currentVersionNo &&
          after?.displayName === before?.displayName &&
          afterVersions === beforeVersions &&
          afterAudits === beforeAudits
        ) {
          pass("stale_version", "VERSION_CONFLICT; unchanged");
        } else {
          fail(
            "stale_version",
            `code=${isFamilyDomainError(e) ? e.code : "?"} v=${after?.currentVersionNo}`
          );
        }
      }
    }

    // TEST 06 — unauthorized editor
    {
      const now = new Date();
      await repo.insertMembership(db, {
        id: randomUUID(),
        familyId: familyIdOriginal,
        userId: editorId,
        role: "EDITOR",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });
      try {
        await updateFamilyIdentity({
          familyId: familyIdOriginal,
          actorUserId: editorId,
          expectedVersion: currentVersion,
          displayName: "Editor Attack",
        });
        fail("unauthorized_editor", "expected FORBIDDEN");
      } catch (e) {
        if (isFamilyDomainError(e) && e.code === "FORBIDDEN") {
          pass("unauthorized_editor", "FORBIDDEN");
        } else {
          fail(
            "unauthorized_editor",
            isFamilyDomainError(e) ? e.code : String(e)
          );
        }
      }
    }

    // TEST 07 — ADMIN update
    {
      await db
        .update(familyMemberships)
        .set({ role: "ADMIN", updatedAt: new Date() })
        .where(
          and(
            eq(familyMemberships.familyId, familyIdOriginal),
            eq(familyMemberships.userId, editorId)
          )
        );
      const res = await updateFamilyIdentity({
        familyId: familyIdOriginal,
        actorUserId: editorId,
        expectedVersion: currentVersion,
        displayName: "Admin Renamed Family",
      });
      if (res.status === "UPDATED" && res.toVersion === currentVersion + 1) {
        pass("admin_update", `v${res.toVersion}`);
        currentVersion = res.toVersion;
      } else {
        fail("admin_update", JSON.stringify(res));
      }
    }

    // TEST 08 — no-op
    {
      const beforeVersions = await repo.countFamilyVersions(
        db,
        familyIdOriginal
      );
      const beforeAudits = await repo.countAuditEvents(db, familyIdOriginal);
      const family = await getFamilyById(familyIdOriginal);
      const res = await updateFamilyIdentity({
        familyId: familyIdOriginal,
        actorUserId: ownerId,
        expectedVersion: currentVersion,
        displayName: family!.displayName,
        surname: family!.surname,
        visibility: family!.visibility,
        discoveryEnabled: family!.discoveryEnabled,
      });
      const afterVersions = await repo.countFamilyVersions(
        db,
        familyIdOriginal
      );
      const afterAudits = await repo.countAuditEvents(db, familyIdOriginal);
      if (
        res.status === "NO_CHANGES" &&
        afterVersions === beforeVersions &&
        afterAudits === beforeAudits &&
        (await getFamilyById(familyIdOriginal))?.currentVersionNo ===
          currentVersion
      ) {
        pass("no_op", "NO_CHANGES; no version/audit");
      } else {
        fail("no_op", JSON.stringify({ res, afterVersions, afterAudits }));
      }
    }

    // TEST 09 — duplicate active owner (DB enforced)
    {
      const third = randomUUID();
      trackedUserIds.push(third);
      await insertFakeUser(third);
      try {
        await repo.insertMembership(db, {
          id: randomUUID(),
          familyId: familyIdOriginal,
          userId: third,
          role: "OWNER",
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        fail("duplicate_owner", "DB allowed second ACTIVE OWNER");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cause =
          e instanceof Error && e.cause instanceof Error
            ? e.cause.message
            : "";
        if (
          /unique|duplicate|one_active_owner|23505/i.test(msg + " " + cause)
        ) {
          pass("duplicate_owner", "DB rejected second ACTIVE OWNER");
        } else {
          fail("duplicate_owner", (msg + " | " + cause).slice(0, 250));
        }
      }
    }

    // TEST 10 — transaction rollback
    {
      try {
        await createFamily(
          {
            ownerUserId: ownerId,
            displayName: "Rollback Probe Family",
          },
          { testHooks: { failAfterMembership: true } }
        );
        fail("rollback", "expected forced failure");
      } catch (e) {
        if (
          e instanceof Error &&
          e.message === "TEST_FORCE_ROLLBACK_AFTER_MEMBERSHIP"
        ) {
          const orphan = await db.execute(sql`
            SELECT count(*)::int AS c FROM families
            WHERE display_name = 'Rollback Probe Family'
          `);
          const c = Number((orphan.rows[0] as { c: number }).c);
          if (c === 0) {
            pass("rollback", "no orphan family after forced failure");
          } else {
            fail("rollback", `orphan families=${c}`);
          }
        } else {
          fail(
            "rollback",
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    // CONCURRENCY — two updates with same expectedVersion
    {
      const fam = await getFamilyById(familyIdOriginal);
      const n = fam!.currentVersionNo;
      const beforeVersions = await repo.countFamilyVersions(
        db,
        familyIdOriginal
      );

      const settled = await Promise.allSettled([
        updateFamilyIdentity({
          familyId: familyIdOriginal,
          actorUserId: ownerId,
          expectedVersion: n,
          displayName: "Concurrent A",
        }),
        updateFamilyIdentity({
          familyId: familyIdOriginal,
          actorUserId: editorId,
          expectedVersion: n,
          displayName: "Concurrent B",
        }),
      ]);

      const successes = settled.filter(
        (s) => s.status === "fulfilled" && s.value.status === "UPDATED"
      );
      const conflicts = settled.filter(
        (s) =>
          s.status === "rejected" &&
          isFamilyDomainError(s.reason) &&
          s.reason.code === "VERSION_CONFLICT"
      );
      const after = await getFamilyById(familyIdOriginal);
      const afterVersions = await repo.countFamilyVersions(
        db,
        familyIdOriginal
      );

      if (
        successes.length === 1 &&
        conflicts.length === 1 &&
        after?.currentVersionNo === n + 1 &&
        afterVersions === beforeVersions + 1
      ) {
        pass(
          "concurrency",
          `exactly one success; final v=${after.currentVersionNo}`
        );
        currentVersion = after.currentVersionNo;
      } else {
        fail(
          "concurrency",
          JSON.stringify({
            successes: successes.length,
            conflicts: conflicts.length,
            final: after?.currentVersionNo,
            versions: afterVersions,
            expectedFinal: n + 1,
          })
        );
      }
    }

    // OWNER_USER_NOT_FOUND
    {
      try {
        await createFamily({
          ownerUserId: randomUUID(),
          displayName: "No Owner",
        });
        fail("owner_required", "expected OWNER_USER_NOT_FOUND");
      } catch (e) {
        if (isFamilyDomainError(e) && e.code === "OWNER_USER_NOT_FOUND") {
          pass("owner_required");
        } else {
          fail(
            "owner_required",
            isFamilyDomainError(e) ? e.code : String(e)
          );
        }
      }
    }
  } finally {
    // Cleanup FK-safe
    if (trackedFamilyIds.length) {
      await db
        .delete(auditEvents)
        .where(inArray(auditEvents.familyId, trackedFamilyIds));
      await db
        .delete(familyVersions)
        .where(inArray(familyVersions.familyId, trackedFamilyIds));
      await db
        .delete(familyMemberships)
        .where(inArray(familyMemberships.familyId, trackedFamilyIds));
      await db.delete(families).where(inArray(families.id, trackedFamilyIds));
    }
    if (trackedUserIds.length) {
      await db
        .delete(familyMemberships)
        .where(inArray(familyMemberships.userId, trackedUserIds));
      await db.delete(users).where(inArray(users.id, trackedUserIds));
    }

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM families) AS families,
        (SELECT count(*)::int FROM family_memberships) AS memberships,
        (SELECT count(*)::int FROM family_versions) AS versions,
        (SELECT count(*)::int FROM audit_events) AS audits
    `);
    const row = counts.rows[0] as Record<string, number>;
    const zero =
      Number(row.users) === 0 &&
      Number(row.families) === 0 &&
      Number(row.memberships) === 0 &&
      Number(row.versions) === 0 &&
      Number(row.audits) === 0;
    if (zero) {
      pass("cleanup", "all business tables empty");
    } else {
      fail("cleanup", JSON.stringify(row));
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
