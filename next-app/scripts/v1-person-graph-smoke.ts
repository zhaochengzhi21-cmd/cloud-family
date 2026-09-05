/**
 * V1 Person + Relationship Graph + Generation smoke.
 * Fictional data only; never prints PII / secrets / share tokens.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  persons,
  relationships,
  familyShareLinks,
  sessions,
} from "../src/db/schema";
import type { FamilyVisibility, MembershipRole } from "../src/db/constants";
import {
  createPerson,
  updatePerson,
  deletePerson,
  getPerson,
} from "../src/v1/services/personService";
import {
  createRelationship,
  deleteRelationship,
} from "../src/v1/services/relationshipService";
import { getFamilyGraph } from "../src/v1/services/familyGraphService";
import { createFamilyShareLink } from "../src/v1/services/familyShareService";
import { computeGenerations } from "../src/v1/domain/relationship/generation";
import { isPersonDomainError } from "../src/v1/domain/person/errors";
import { isRelationshipDomainError } from "../src/v1/domain/relationship/errors";
import * as relRepo from "../src/v1/repositories/relationshipRepository";

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

function ctxUser(userId: string) {
  return { kind: "USER" as const, userId };
}
function ctxAnon() {
  return { kind: "ANONYMOUS" as const };
}
function ctxShare(rawToken: string) {
  return { kind: "SHARE_LINK" as const, rawToken };
}

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({
    id,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertFamily(
  db: ReturnType<typeof getV1Db>,
  opts: {
    id: string;
    ownerId: string;
    visibility: FamilyVisibility;
    discoveryEnabled?: boolean;
    version?: number;
  }
) {
  const now = new Date();
  const v = opts.version ?? 1;
  await db.insert(families).values({
    id: opts.id,
    displayName: `Graph ${opts.visibility}`,
    surname: "T",
    visibility: opts.visibility,
    discoveryEnabled: opts.discoveryEnabled ?? false,
    createdByUserId: opts.ownerId,
    currentVersionNo: v,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(familyMemberships).values({
    id: randomUUID(),
    familyId: opts.id,
    userId: opts.ownerId,
    role: "OWNER",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(familyVersions).values({
    id: randomUUID(),
    familyId: opts.id,
    versionNo: v,
    createdByUserId: opts.ownerId,
    schemaVersion: 1,
    summary: "seed",
    createdAt: now,
  });
}

async function insertMember(
  db: ReturnType<typeof getV1Db>,
  familyId: string,
  userId: string,
  role: MembershipRole
) {
  const now = new Date();
  await db.insert(familyMemberships).values({
    id: randomUUID(),
    familyId,
    userId,
    role,
    status: "ACTIVE",
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
  const trackedUsers: string[] = [];
  const trackedFamilies: string[] = [];

  try {
    const ownerId = randomUUID();
    const adminId = randomUUID();
    const editorId = randomUUID();
    const viewerId = randomUUID();
    const ownerBId = randomUUID();
    for (const id of [ownerId, adminId, editorId, viewerId, ownerBId]) {
      await insertUser(db, id);
      trackedUsers.push(id);
    }

    const famId = randomUUID();
    const famB = randomUUID();
    const pubFam = randomUUID();
    const linkFam = randomUUID();
    const discFam = randomUUID();
    await insertFamily(db, { id: famId, ownerId, visibility: "PRIVATE" });
    await insertFamily(db, { id: famB, ownerId: ownerBId, visibility: "PRIVATE" });
    await insertFamily(db, { id: pubFam, ownerId, visibility: "PUBLIC" });
    await insertFamily(db, { id: linkFam, ownerId, visibility: "LINK" });
    await insertFamily(db, {
      id: discFam,
      ownerId,
      visibility: "PRIVATE",
      discoveryEnabled: true,
    });
    trackedFamilies.push(famId, famB, pubFam, linkFam, discFam);

    for (const f of [famId, pubFam, linkFam, discFam]) {
      await insertMember(db, f, adminId, "ADMIN");
      await insertMember(db, f, editorId, "EDITOR");
      await insertMember(db, f, viewerId, "VIEWER");
    }

    const [famRow] = await db
      .select({ v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, famId));
    let expectedFamilyVersion = famRow.v;

    // ---- P01 create OWNER ----
    const p1 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Ancestor A",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
    });
    if (p1.person.revisionNo === 1 && p1.familyVersion === expectedFamilyVersion + 1) {
      pass("P01_create", `rev=1 famVer=${p1.familyVersion}`);
      expectedFamilyVersion = p1.familyVersion;
    } else fail("P01_create", JSON.stringify(p1));

    // ---- P02 editor create ----
    const p2 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(editorId),
      preferredName: "Child B",
      livingStatus: "DECEASED",
    });
    expectedFamilyVersion = p2.familyVersion;
    pass("P02_editor_create", "ok");

    // ---- P03 viewer deny ----
    try {
      await createPerson({
        familyId: famId,
        actorContext: ctxUser(viewerId),
        preferredName: "Nope",
      });
      fail("P03_viewer_create", "should deny");
    } catch (e) {
      if (isPersonDomainError(e) && e.code === "FORBIDDEN") pass("P03_viewer_create", "FORBIDDEN");
      else fail("P03_viewer_create", String(e));
    }

    // ---- P04 update ----
    const up = await updatePerson({
      personId: p1.person.id,
      actorContext: ctxUser(ownerId),
      expectedRevision: 1,
      preferredName: "Ancestor A Renamed",
    });
    if (
      up.status === "UPDATED" &&
      up.person.revisionNo === 2 &&
      up.familyVersion === expectedFamilyVersion + 1
    ) {
      expectedFamilyVersion = up.familyVersion;
      pass("P04_update", "rev 1→2");
    } else fail("P04_update", JSON.stringify(up));

    // ---- P05 stale ----
    const [r1, r2] = await Promise.allSettled([
      updatePerson({
        personId: p1.person.id,
        actorContext: ctxUser(ownerId),
        expectedRevision: 2,
        gender: "MALE",
      }),
      updatePerson({
        personId: p1.person.id,
        actorContext: ctxUser(adminId),
        expectedRevision: 2,
        gender: "FEMALE",
      }),
    ]);
    const successes = [r1, r2].filter((x) => x.status === "fulfilled");
    const conflicts = [r1, r2].filter(
      (x) =>
        x.status === "rejected" &&
        isPersonDomainError(x.reason) &&
        x.reason.code === "PERSON_VERSION_CONFLICT"
    );
    if (successes.length === 1 && conflicts.length === 1) {
      const ok = successes[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof updatePerson>>>;
      if (ok.value.status === "UPDATED") {
        expectedFamilyVersion = ok.value.familyVersion;
      }
      pass("P05_stale", "exactly one success");
    } else fail("P05_stale", `ok=${successes.length} conflict=${conflicts.length}`);

    // ---- P06 no-op ----
    const cur = await getPerson(p1.person.id, ctxUser(ownerId));
    const auditsBefore = await db.execute(sql`
      SELECT count(*)::int AS c FROM audit_events WHERE family_id = ${famId}
    `);
    const verBefore = await db.execute(sql`
      SELECT current_version_no FROM families WHERE id = ${famId}
    `);
    const noop = await updatePerson({
      personId: p1.person.id,
      actorContext: ctxUser(ownerId),
      expectedRevision: cur.revisionNo,
      preferredName: cur.preferredName,
      gender: cur.gender,
      livingStatus: cur.livingStatus,
      privacyLevel: cur.privacyLevel,
    });
    const auditsAfter = await db.execute(sql`
      SELECT count(*)::int AS c FROM audit_events WHERE family_id = ${famId}
    `);
    const verAfter = await db.execute(sql`
      SELECT current_version_no FROM families WHERE id = ${famId}
    `);
    if (
      noop.status === "NO_CHANGES" &&
      Number((auditsBefore.rows[0] as { c: number }).c) ===
        Number((auditsAfter.rows[0] as { c: number }).c) &&
      Number((verBefore.rows[0] as { current_version_no: number }).current_version_no) ===
        Number((verAfter.rows[0] as { current_version_no: number }).current_version_no)
    ) {
      pass("P06_noop", "no version/audit");
    } else fail("P06_noop", JSON.stringify(noop));
    expectedFamilyVersion = Number(
      (verAfter.rows[0] as { current_version_no: number }).current_version_no
    );

    // ---- P07 PRIVATE edit ----
    const priv = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Secret",
      privacyLevel: "PRIVATE",
      livingStatus: "DECEASED",
    });
    expectedFamilyVersion = priv.familyVersion;
    await updatePerson({
      personId: priv.person.id,
      actorContext: ctxUser(ownerId),
      expectedRevision: 1,
      gender: "MALE",
    }).then((r) => {
      if (r.status === "UPDATED") {
        expectedFamilyVersion = r.familyVersion;
        pass("P07_private_owner", "ALLOW");
      } else fail("P07_private_owner", "fail");
    });
    try {
      await updatePerson({
        personId: priv.person.id,
        actorContext: ctxUser(editorId),
        expectedRevision: 2,
        gender: "FEMALE",
      });
      fail("P07_private_editor", "should deny");
    } catch (e) {
      if (isPersonDomainError(e) && e.code === "FORBIDDEN")
        pass("P07_private_editor", "DENY");
      else fail("P07_private_editor", String(e));
    }

    // ---- R01 parent ----
    const parentRel = await createRelationship({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      personAId: p1.person.id,
      personBId: p2.person.id,
      relationshipType: "BIOLOGICAL_PARENT",
    });
    if (
      parentRel.relationship.fromPersonId === p1.person.id &&
      parentRel.relationship.toPersonId === p2.person.id
    ) {
      expectedFamilyVersion = parentRel.familyVersion;
      pass("R01_parent", "from=parent to=child");
    } else fail("R01_parent", "direction wrong");

    // ---- R03 duplicate ----
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: p1.person.id,
        personBId: p2.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      });
      fail("R03_duplicate", "should deny");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "DUPLICATE_RELATIONSHIP")
        pass("R03_duplicate", "DENIED");
      else fail("R03_duplicate", String(e));
    }

    // ---- R04 soft-delete recreate ----
    const delRel = await deleteRelationship(
      parentRel.relationship.id,
      ctxUser(ownerId)
    );
    expectedFamilyVersion = delRel.familyVersion;
    const recreated = await createRelationship({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      personAId: p1.person.id,
      personBId: p2.person.id,
      relationshipType: "BIOLOGICAL_PARENT",
    });
    expectedFamilyVersion = recreated.familyVersion;
    pass("R04_recreate", "ok");

    // ---- R05 self ----
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: p1.person.id,
        personBId: p1.person.id,
        relationshipType: "SPOUSE",
      });
      fail("R05_self", "should deny");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "SELF_RELATIONSHIP")
        pass("R05_self", "DENIED");
      else fail("R05_self", String(e));
    }

    // ---- R06 cross family ----
    const pB = await createPerson({
      familyId: famB,
      actorContext: ctxUser(ownerBId),
      preferredName: "OtherFam",
    });
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: p1.person.id,
        personBId: pB.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      });
      fail("R06_cross_family", "should deny");
    } catch (e) {
      if (
        isRelationshipDomainError(e) &&
        e.code === "CROSS_FAMILY_RELATIONSHIP"
      )
        pass("R06_cross_family", "BLOCKED");
      else fail("R06_cross_family", String(e));
    }

    // ---- R07 deleted person ----
    const doomed = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Doomed",
      livingStatus: "DECEASED",
    });
    expectedFamilyVersion = doomed.familyVersion;
    const delP = await deletePerson(doomed.person.id, ctxUser(adminId));
    expectedFamilyVersion = delP.familyVersion;
    pass("P08_soft_delete", `relsRemoved=${delP.relationshipsRemovedCount}`);
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: p1.person.id,
        personBId: doomed.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      });
      fail("R07_deleted_person", "should deny");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "PERSON_DELETED")
        pass("R07_deleted_person", "BLOCKED");
      else fail("R07_deleted_person", String(e));
    }

    // ---- R08/R09 spouse ----
    const s1 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Spouse1",
      livingStatus: "DECEASED",
    });
    const s2 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Spouse2",
      livingStatus: "DECEASED",
    });
    expectedFamilyVersion = s2.familyVersion;
    const sp = await createRelationship({
      familyId: famId,
      actorContext: ctxUser(editorId),
      personAId: s2.person.id,
      personBId: s1.person.id,
      relationshipType: "SPOUSE",
    });
    const minId = s1.person.id < s2.person.id ? s1.person.id : s2.person.id;
    const maxId = s1.person.id < s2.person.id ? s2.person.id : s1.person.id;
    if (
      sp.relationship.fromPersonId === minId &&
      sp.relationship.toPersonId === maxId
    ) {
      expectedFamilyVersion = sp.familyVersion;
      pass("R08_spouse_canonical", "min→from max→to");
    } else fail("R08_spouse_canonical", "order wrong");
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: s1.person.id,
        personBId: s2.person.id,
        relationshipType: "SPOUSE",
      });
      fail("R09_reverse_spouse", "should duplicate");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "DUPLICATE_RELATIONSHIP")
        pass("R09_reverse_spouse", "DENIED");
      else fail("R09_reverse_spouse", String(e));
    }

    // ---- R10 multiple spouse ----
    const s3 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "Spouse3",
      livingStatus: "DECEASED",
    });
    const sp2 = await createRelationship({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      personAId: s1.person.id,
      personBId: s3.person.id,
      relationshipType: "SPOUSE",
    });
    expectedFamilyVersion = sp2.familyVersion;
    pass("R10_multi_spouse", "allowed");

    // ---- Cycles ----
    // recreate clean chain for cycle tests in pubFam / dedicated persons
    const cA = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "CA",
      livingStatus: "DECEASED",
    });
    const cB = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "CB",
      livingStatus: "DECEASED",
    });
    const cC = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "CC",
      livingStatus: "DECEASED",
    });
    await createRelationship({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      personAId: cA.person.id,
      personBId: cB.person.id,
      relationshipType: "BIOLOGICAL_PARENT",
    });
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: cB.person.id,
        personBId: cA.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      });
      fail("C01_direct_cycle", "should block");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "ANCESTRY_CYCLE")
        pass("C01_direct_cycle", "BLOCKED");
      else fail("C01_direct_cycle", String(e));
    }

    await createRelationship({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      personAId: cB.person.id,
      personBId: cC.person.id,
      relationshipType: "ADOPTIVE_PARENT",
    });
    try {
      await createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: cC.person.id,
        personBId: cA.person.id,
        relationshipType: "STEP_PARENT",
      });
      fail("C02_C03_multi_mixed", "should block");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "ANCESTRY_CYCLE")
        pass("C02_C03_multi_mixed", "BLOCKED");
      else fail("C02_C03_multi_mixed", String(e));
    }

    // ---- C04 concurrent cycle ----
    const x1 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "X1",
      livingStatus: "DECEASED",
    });
    const x2 = await createPerson({
      familyId: famId,
      actorContext: ctxUser(ownerId),
      preferredName: "X2",
      livingStatus: "DECEASED",
    });
    const [cx1, cx2] = await Promise.allSettled([
      createRelationship({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        personAId: x1.person.id,
        personBId: x2.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      }),
      createRelationship({
        familyId: famId,
        actorContext: ctxUser(adminId),
        personAId: x2.person.id,
        personBId: x1.person.id,
        relationshipType: "BIOLOGICAL_PARENT",
      }),
    ]);
    const cxOk = [cx1, cx2].filter((x) => x.status === "fulfilled");
    const cxCycle = [cx1, cx2].filter(
      (x) =>
        x.status === "rejected" &&
        isRelationshipDomainError(x.reason) &&
        x.reason.code === "ANCESTRY_CYCLE"
    );
    if (cxOk.length === 1 && cxCycle.length === 1) {
      pass("C04_concurrent_cycle", "exactly one");
    } else fail("C04_concurrent_cycle", `ok=${cxOk.length} cycle=${cxCycle.length}`);

    // refresh family version after concurrent
    const [fv] = await db
      .select({ v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, famId));
    expectedFamilyVersion = fv.v;

    // ---- Generation pure + graph ----
    {
      const empty = computeGenerations([], []);
      if (empty.totalGenerations === 0) pass("G01_empty", "0");
      else fail("G01_empty", String(empty.totalGenerations));
    }
    {
      const iso = computeGenerations(["p"], []);
      if (iso.totalGenerations === 1 && iso.personGenerations.get("p") === 1)
        pass("G02_isolated", "1");
      else fail("G02_isolated", "bad");
    }
    {
      const chain = computeGenerations(
        ["a", "b", "c", "d"],
        [
          { fromPersonId: "a", toPersonId: "b" },
          { fromPersonId: "b", toPersonId: "c" },
          { fromPersonId: "c", toPersonId: "d" },
        ]
      );
      if (
        chain.personGenerations.get("a") === 1 &&
        chain.personGenerations.get("d") === 4 &&
        chain.totalGenerations === 4
      )
        pass("G03_chain", "1..4");
      else fail("G03_chain", "bad");
    }
    {
      const mr = computeGenerations(
        ["a", "b", "c"],
        [
          { fromPersonId: "a", toPersonId: "c" },
          { fromPersonId: "b", toPersonId: "c" },
        ]
      );
      if (
        mr.personGenerations.get("a") === 1 &&
        mr.personGenerations.get("b") === 1 &&
        mr.personGenerations.get("c") === 2
      )
        pass("G04_multi_root", "ok");
      else fail("G04_multi_root", "bad");
    }
    {
      const dc = computeGenerations(
        ["a", "b", "c", "d", "e"],
        [
          { fromPersonId: "a", toPersonId: "b" },
          { fromPersonId: "c", toPersonId: "d" },
          { fromPersonId: "d", toPersonId: "e" },
        ]
      );
      if (dc.totalGenerations === 3 && dc.componentCount === 2)
        pass("G05_disconnected", `total=3 comps=2`);
      else fail("G05_disconnected", JSON.stringify(dc));
    }
    {
      // spouse ignored: only parent edges passed
      const g = computeGenerations(
        ["a", "b", "c"],
        [{ fromPersonId: "a", toPersonId: "b" }]
      );
      if (g.personGenerations.get("c") === 1 && g.personGenerations.get("b") === 2)
        pass("G06_spouse_ignored", "C stays gen1");
      else fail("G06_spouse_ignored", "bad");
    }
    {
      // pedigree collapse: longest path
      const g = computeGenerations(
        ["a", "b", "c", "d"],
        [
          { fromPersonId: "a", toPersonId: "b" },
          { fromPersonId: "b", toPersonId: "d" },
          { fromPersonId: "a", toPersonId: "c" },
          { fromPersonId: "c", toPersonId: "d" },
          { fromPersonId: "x" as string, toPersonId: "d" }, // filtered if x missing — skip
        ].filter((e) => ["a", "b", "c", "d"].includes(e.fromPersonId))
      );
      // add longer path via extra
      const g2 = computeGenerations(
        ["p1", "p2", "p3", "child"],
        [
          { fromPersonId: "p1", toPersonId: "p2" },
          { fromPersonId: "p2", toPersonId: "p3" },
          { fromPersonId: "p3", toPersonId: "child" },
          { fromPersonId: "p1", toPersonId: "child" },
        ]
      );
      if (g2.personGenerations.get("child") === 4)
        pass("G07_pedigree", "longest=4");
      else fail("G07_pedigree", String(g2.personGenerations.get("child")));
      void g;
    }
    {
      const g = computeGenerations(
        ["a", "b", "c"],
        [
          { fromPersonId: "a", toPersonId: "b" },
          { fromPersonId: "a", toPersonId: "c" },
          { fromPersonId: "b", toPersonId: "c" },
        ]
      );
      // a=1,b=2,c=max(1,2)+1=3; edge a→c: 3 != 1+1 → tension
      if (
        g.personGenerations.get("c") === 3 &&
        g.generationTensionEdges.some(
          (e) => e.fromPersonId === "a" && e.toPersonId === "c"
        )
      )
        pass("G08_tension", "reported not rejected");
      else fail("G08_tension", JSON.stringify(g.generationTensionEdges));
    }
    {
      try {
        computeGenerations(
          ["a", "b"],
          [
            { fromPersonId: "a", toPersonId: "b" },
            { fromPersonId: "b", toPersonId: "a" },
          ]
        );
        fail("G09_corrupt_cycle", "should throw");
      } catch (e) {
        if (
          isRelationshipDomainError(e) &&
          e.code === "GRAPH_CYCLE_DETECTED"
        )
          pass("G09_corrupt_cycle", "GRAPH_CYCLE_DETECTED");
        else fail("G09_corrupt_cycle", String(e));
      }
    }

    // ---- Privacy graph on PUBLIC family ----
    const living = await createPerson({
      familyId: pubFam,
      actorContext: ctxUser(ownerId),
      preferredName: "Living",
      livingStatus: "LIVING",
      privacyLevel: "INHERIT",
    });
    const deceased = await createPerson({
      familyId: pubFam,
      actorContext: ctxUser(ownerId),
      preferredName: "Deceased",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
    });
    const privateP = await createPerson({
      familyId: pubFam,
      actorContext: ctxUser(ownerId),
      preferredName: "PrivateP",
      livingStatus: "DECEASED",
      privacyLevel: "PRIVATE",
    });
    await createRelationship({
      familyId: pubFam,
      actorContext: ctxUser(ownerId),
      personAId: deceased.person.id,
      personBId: living.person.id,
      relationshipType: "BIOLOGICAL_PARENT",
    });
    await createRelationship({
      familyId: pubFam,
      actorContext: ctxUser(ownerId),
      personAId: deceased.person.id,
      personBId: privateP.person.id,
      relationshipType: "BIOLOGICAL_PARENT",
    });

    const anonGraph = await getFamilyGraph(pubFam, ctxAnon());
    if (!anonGraph.persons.some((p) => p.id === living.person.id))
      pass("V01_living_hidden", "anon");
    else fail("V01_living_hidden", "leak");
    if (anonGraph.persons.some((p) => p.id === deceased.person.id))
      pass("V02_deceased_visible", "anon");
    else fail("V02_deceased_visible", "missing");
    if (!anonGraph.persons.some((p) => p.id === privateP.person.id))
      pass("V03_private_hidden_anon", "ok");
    else fail("V03_private_hidden_anon", "leak");

    const editorGraph = await getFamilyGraph(pubFam, ctxUser(editorId));
    if (!editorGraph.persons.some((p) => p.id === privateP.person.id))
      pass("V03_private_editor", "hidden");
    else fail("V03_private_editor", "visible");
    const ownerGraph = await getFamilyGraph(pubFam, ctxUser(ownerId));
    if (ownerGraph.persons.some((p) => p.id === privateP.person.id))
      pass("V03_private_owner", "visible");
    else fail("V03_private_owner", "hidden");

    // relationship sidechannel: deceased→private must not appear for anon
    if (
      !anonGraph.relationships.some(
        (r) =>
          r.toPersonId === privateP.person.id ||
          r.fromPersonId === privateP.person.id
      )
    )
      pass("V04_relationship_leak", "BLOCKED");
    else fail("V04_relationship_leak", "edge leaked");

    // living edge also gone for anon
    if (
      !anonGraph.relationships.some(
        (r) =>
          r.toPersonId === living.person.id ||
          r.fromPersonId === living.person.id
      )
    )
      pass("V01b_living_edges", "hidden");
    else fail("V01b_living_edges", "leak");

    // LINK share — living still hidden
    const share = await createFamilyShareLink(linkFam, ownerId);
    const linkLiving = await createPerson({
      familyId: linkFam,
      actorContext: ctxUser(ownerId),
      preferredName: "LinkLiving",
      livingStatus: "LIVING",
      privacyLevel: "INHERIT",
    });
    const linkGraph = await getFamilyGraph(linkFam, ctxShare(share.rawToken));
    if (!linkGraph.persons.some((p) => p.id === linkLiving.person.id))
      pass("V05_link_living", "hidden");
    else fail("V05_link_living", "leak");

    // discovery isolation
    try {
      await getFamilyGraph(discFam, ctxAnon());
      fail("V06_discovery", "should deny");
    } catch (e) {
      if (isRelationshipDomainError(e) && e.code === "FORBIDDEN")
        pass("V06_discovery", "DENY");
      else fail("V06_discovery", String(e));
    }

    // ---- Family version sequence check ----
    const [finalFam] = await db
      .select({ id: families.id, v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, famId));
    if (finalFam.id === famId && finalFam.v >= expectedFamilyVersion) {
      pass("FAMILY_VERSION_GLOBAL", `v=${finalFam.v} id stable`);
    } else fail("FAMILY_VERSION_GLOBAL", "mismatch");

    // concurrent person creates
    const [cp1, cp2] = await Promise.all([
      createPerson({
        familyId: famId,
        actorContext: ctxUser(ownerId),
        preferredName: "Concurrent1",
      }),
      createPerson({
        familyId: famId,
        actorContext: ctxUser(adminId),
        preferredName: "Concurrent2",
      }),
    ]);
    const [afterConc] = await db
      .select({ v: families.currentVersionNo })
      .from(families)
      .where(eq(families.id, famId));
    if (
      Math.abs(cp1.familyVersion - cp2.familyVersion) === 1 &&
      afterConc.v === Math.max(cp1.familyVersion, cp2.familyVersion)
    ) {
      pass("concurrent_family_mutation", `→${afterConc.v}`);
    } else
      fail(
        "concurrent_family_mutation",
        `v1=${cp1.familyVersion} v2=${cp2.familyVersion} final=${afterConc.v}`
      );

    // NO parent fields on person schema — static check via drizzle columns
    const personCols = Object.keys(persons);
    const banned = ["fatherId", "motherId", "parentId", "spouseId", "childrenIds", "generation"];
    if (!banned.some((b) => personCols.includes(b)))
      pass("NO_PARENT_FIELDS_ON_PERSON", "ok");
    else fail("NO_PARENT_FIELDS_ON_PERSON", personCols.join(","));

    // ---- Cleanup ----
    await db
      .delete(familyShareLinks)
      .where(inArray(familyShareLinks.familyId, trackedFamilies));
    await db
      .delete(relationships)
      .where(inArray(relationships.familyId, trackedFamilies));
    await db.delete(persons).where(inArray(persons.familyId, trackedFamilies));
    await db
      .delete(familyMemberships)
      .where(inArray(familyMemberships.familyId, trackedFamilies));
    await db
      .delete(familyVersions)
      .where(inArray(familyVersions.familyId, trackedFamilies));
    await db
      .delete(auditEvents)
      .where(inArray(auditEvents.familyId, trackedFamilies));
    await db.delete(families).where(inArray(families.id, trackedFamilies));
    await db.delete(sessions).where(inArray(sessions.userId, trackedUsers));
    await db.delete(users).where(inArray(users.id, trackedUsers));

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM families) AS families,
        (SELECT count(*)::int FROM family_memberships) AS memberships,
        (SELECT count(*)::int FROM persons) AS persons,
        (SELECT count(*)::int FROM relationships) AS relationships,
        (SELECT count(*)::int FROM family_versions) AS versions,
        (SELECT count(*)::int FROM audit_events) AS audits,
        (SELECT count(*)::int FROM sessions) AS sessions,
        (SELECT count(*)::int FROM family_share_links) AS share_links
    `);
    const row = counts.rows[0] as Record<string, number>;
    const zero = Object.values(row).every((n) => Number(n) === 0);
    if (zero) pass("cleanup", "all 0");
    else fail("cleanup", JSON.stringify(row));

    void relRepo;
  } catch (e) {
    console.error("SMOKE FATAL", e);
    fail("fatal", e instanceof Error ? e.message : String(e));
  } finally {
    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== SUMMARY ===");
  console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("PERSON_GRAPH_SMOKE = PASS");
  process.exit(0);
}

main();
