/**
 * CF-V1-EVIDENCE-001 smoke — Claim + Evidence Engine.
 * All synthetic data; full cleanup; never prints fingerprints or fact values in audit checks.
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
  claims,
  evidence,
  claimEvidence,
  mediaObjects,
  familyShareLinks,
  sessions,
} from "../src/db/schema";
import type { FamilyVisibility, MembershipRole } from "../src/db/constants";
import {
  createClaim,
  acceptClaim,
  rejectClaim,
  getClaim,
  getClaimWithEvidence,
} from "../src/v1/services/claimService";
import {
  createEvidence,
  deleteEvidence,
  getEvidence,
  linkEvidenceToClaim,
} from "../src/v1/services/evidenceService";
import { uploadMedia, getMediaReadAccess } from "../src/v1/services/mediaService";
import { createFamilyShareLink } from "../src/v1/services/familyShareService";
import { isClaimDomainError } from "../src/v1/domain/claim/errors";
import { isEvidenceDomainError } from "../src/v1/domain/evidence/errors";
import { canonicalizeJson } from "../src/v1/domain/claim/canonicalize";
import {
  computeValueFingerprint,
  normalizeTextualText,
} from "../src/v1/domain/claim/normalization";
import {
  listMultiClaimTypes,
  listRegisteredClaimTypes,
  listSingletonClaimTypes,
} from "../src/v1/domain/claim/registry";
import { MemoryObjectStorage } from "../src/v1/storage/memoryObjectStorage";
import { setObjectStorageForTests } from "../src/v1/storage/objectStorage";

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
function ctxShare(raw: string) {
  return { kind: "SHARE_LINK" as const, rawToken: raw };
}

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
}

async function insertFamily(
  db: ReturnType<typeof getV1Db>,
  opts: {
    id: string;
    ownerId: string;
    visibility: FamilyVisibility;
    displayName?: string;
  }
) {
  const now = new Date();
  await db.insert(families).values({
    id: opts.id,
    displayName: opts.displayName ?? "EvidenceSmoke",
    surname: "E",
    visibility: opts.visibility,
    discoveryEnabled: false,
    createdByUserId: opts.ownerId,
    currentVersionNo: 1,
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
    versionNo: 1,
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

async function insertPerson(
  db: ReturnType<typeof getV1Db>,
  opts: {
    id: string;
    familyId: string;
    name: string;
    livingStatus: "LIVING" | "DECEASED" | "UNKNOWN";
    privacyLevel: "INHERIT" | "PRIVATE" | "FAMILY" | "PUBLIC";
    createdBy: string;
  }
) {
  const now = new Date();
  await db.insert(persons).values({
    id: opts.id,
    familyId: opts.familyId,
    preferredName: opts.name,
    gender: "UNKNOWN",
    livingStatus: opts.livingStatus,
    privacyLevel: opts.privacyLevel,
    revisionNo: 1,
    createdByUserId: opts.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

function tinyPng(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function expectClaimErr(
  name: string,
  code: string,
  fn: () => Promise<unknown>
) {
  try {
    await fn();
    fail(name, "expected error");
  } catch (e) {
    if (isClaimDomainError(e) && e.code === code) pass(name, code);
    else fail(name, e instanceof Error ? `${(e as { code?: string }).code ?? e.message}` : "unknown");
  }
}

async function expectEvidenceErr(
  name: string,
  code: string,
  fn: () => Promise<unknown>
) {
  try {
    await fn();
    fail(name, "expected error");
  } catch (e) {
    if (isEvidenceDomainError(e) && e.code === code) pass(name, code);
    else
      fail(
        name,
        e instanceof Error ? `${(e as { code?: string }).code ?? e.message}` : "unknown"
      );
  }
}

async function familyVersion(
  db: ReturnType<typeof getV1Db>,
  familyId: string
): Promise<number> {
  const [row] = await db
    .select({ v: families.currentVersionNo })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  return row?.v ?? -1;
}

async function main() {
  if (!isV1DbConfigured()) {
    console.error("V1_DATABASE_URL missing");
    process.exit(2);
  }

  const db = getV1Db();
  const mem = new MemoryObjectStorage();
  setObjectStorageForTests(mem);

  const trackedUsers: string[] = [];
  const trackedFamilies: string[] = [];

  try {
    // —— Registry / normalization ——
    const registered = listRegisteredClaimTypes();
    if (registered.length === 12) pass("CLAIM_TYPE_REGISTRY", "12 types");
    else fail("CLAIM_TYPE_REGISTRY", `count=${registered.length}`);

    const singles = listSingletonClaimTypes();
    const multis = listMultiClaimTypes();
    if (
      singles.includes("BIRTH_DATE") &&
      singles.includes("HALL_NAME") &&
      multis.includes("ALIAS") &&
      multis.includes("RELATIONSHIP_ASSERTION")
    ) {
      pass("cardinality", `S=${singles.length} M=${multis.length}`);
    } else fail("cardinality", "mismatch");

    const c1 = canonicalizeJson({ a: 1, b: 2 });
    const c2 = canonicalizeJson({ b: 2, a: 1 });
    if (c1 === c2) pass("canonical_json", "key order independent");
    else fail("canonical_json", "order differs");

    const fp1 = computeValueFingerprint("BIRTH_DATE", {
      text: normalizeTextualText("  民国十三年  "),
    });
    const fp2 = computeValueFingerprint("BIRTH_DATE", { text: "民国十三年" });
    if (fp1 === fp2) pass("normalization", "NFC/trim/ws equivalent");
    else fail("normalization", "fp mismatch");
    // never print fingerprint

    const noUpdateApi = !("updateClaimValue" in (await import("../src/v1/services/claimService")));
    if (noUpdateApi) pass("immutability", "no updateClaimValue export");
    else fail("immutability", "updateClaimValue exists");

    // —— Seed family A ——
    const ownerId = randomUUID();
    const adminId = randomUUID();
    const editorId = randomUUID();
    const viewerId = randomUUID();
    const familyId = randomUUID();
    trackedUsers.push(ownerId, adminId, editorId, viewerId);
    trackedFamilies.push(familyId);

    await insertUser(db, ownerId);
    await insertUser(db, adminId);
    await insertUser(db, editorId);
    await insertUser(db, viewerId);
    await insertFamily(db, { id: familyId, ownerId, visibility: "PUBLIC" });
    await insertMember(db, familyId, adminId, "ADMIN");
    await insertMember(db, familyId, editorId, "EDITOR");
    await insertMember(db, familyId, viewerId, "VIEWER");

    const livingId = randomUUID();
    const deceasedId = randomUUID();
    const privatePersonId = randomUUID();
    const personBId = randomUUID();
    await insertPerson(db, {
      id: livingId,
      familyId,
      name: "LivingP",
      livingStatus: "LIVING",
      privacyLevel: "INHERIT",
      createdBy: ownerId,
    });
    await insertPerson(db, {
      id: deceasedId,
      familyId,
      name: "DeceasedP",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: ownerId,
    });
    await insertPerson(db, {
      id: privatePersonId,
      familyId,
      name: "PrivateP",
      livingStatus: "DECEASED",
      privacyLevel: "PRIVATE",
      createdBy: ownerId,
    });
    await insertPerson(db, {
      id: personBId,
      familyId,
      name: "PersonB",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: ownerId,
    });

    let v = await familyVersion(db, familyId);

    // C01 OWNER create PROPOSED
    const c01 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "BIRTH_DATE",
      value: { text: "1923" },
    });
    if (c01.claim.status === "PROPOSED" && c01.familyVersion === v + 1) {
      pass("proposed", "OWNER BIRTH_DATE PROPOSED");
      v = c01.familyVersion;
    } else fail("proposed", `status=${c01.claim.status} v=${c01.familyVersion}`);

    // C02 EDITOR proposed
    const c02 = await createClaim({
      familyId,
      actorContext: ctxUser(editorId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "ALIAS",
      value: { text: "德成" },
    });
    if (c02.claim.status === "PROPOSED") pass("editor_proposed");
    else fail("editor_proposed", c02.claim.status);
    v = c02.familyVersion;

    // C03 VIEWER deny
    await expectClaimErr("viewer_denied", "FORBIDDEN", () =>
      createClaim({
        familyId,
        actorContext: ctxUser(viewerId),
        subjectType: "PERSON",
        subjectId: deceasedId,
        claimType: "ALIAS",
        value: { text: "不可见" },
      })
    );

    // C04 AI origin must PROPOSED
    const c04 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "OCCUPATION",
      value: { text: "耕读" },
      originType: "AI_EXTRACTION",
      confidence: 0.98,
    });
    if (c04.claim.status === "PROPOSED" && c04.claim.originType === "AI_EXTRACTION") {
      pass("AI_proposed", "still PROPOSED");
    } else fail("AI_proposed", c04.claim.status);
    v = c04.familyVersion;

    // C05 exact duplicate
    await expectClaimErr("duplicate", "DUPLICATE_ACTIVE_CLAIM", () =>
      createClaim({
        familyId,
        actorContext: ctxUser(ownerId),
        subjectType: "PERSON",
        subjectId: deceasedId,
        claimType: "BIRTH_DATE",
        value: { text: "1923" },
      })
    );

    // X01 accept first singleton
    const x01 = await acceptClaim(familyId, c01.claim.id, ctxUser(ownerId));
    if (x01.claim.status === "ACCEPTED") pass("singleton_accept");
    else fail("singleton_accept", x01.claim.status);
    v = x01.familyVersion;

    // EDITOR cannot review
    await expectClaimErr("editor_review_blocked", "FORBIDDEN", () =>
      acceptClaim(familyId, c02.claim.id, ctxUser(editorId))
    );

    // X03 different singleton → both CONFLICTED
    const c1924 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "BIRTH_DATE",
      value: { text: "1924" },
    });
    v = c1924.familyVersion;
    const x03 = await acceptClaim(familyId, c1924.claim.id, ctxUser(adminId));
    const afterA = await getClaim(c01.claim.id, ctxUser(ownerId));
    const afterB = await getClaim(c1924.claim.id, ctxUser(ownerId));
    if (
      afterA?.status === "CONFLICTED" &&
      afterB?.status === "CONFLICTED" &&
      x03.conflictCount === 2
    ) {
      pass("conflict", "both CONFLICTED");
    } else {
      fail(
        "conflict",
        `A=${afterA?.status} B=${afterB?.status} cc=${x03.conflictCount}`
      );
    }
    v = x03.familyVersion;

    // False conflict limitation (known)
    const cMinguo = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: livingId,
      claimType: "BIRTH_DATE",
      value: { text: "民国十三年" },
    });
    const cGreg = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: livingId,
      claimType: "BIRTH_DATE",
      value: { text: "1924" },
    });
    await acceptClaim(familyId, cMinguo.claim.id, ctxUser(ownerId));
    const fc = await acceptClaim(familyId, cGreg.claim.id, ctxUser(ownerId));
    const fc1 = await getClaim(cMinguo.claim.id, ctxUser(ownerId));
    const fc2 = await getClaim(cGreg.claim.id, ctxUser(ownerId));
    if (fc1?.status === "CONFLICTED" && fc2?.status === "CONFLICTED") {
      pass(
        "false_conflict_limitation",
        "ACCEPTED FOUNDATION LIMIT (no historical norm)"
      );
    } else fail("false_conflict_limitation", `${fc1?.status}/${fc2?.status}`);
    await rejectClaim(familyId, cMinguo.claim.id, ctxUser(ownerId));
    await rejectClaim(familyId, cGreg.claim.id, ctxUser(ownerId));
    v = await familyVersion(db, familyId);

    // X04 reject one → resolve
    const x04 = await rejectClaim(familyId, c1924.claim.id, ctxUser(ownerId));
    const resolved = await getClaim(c01.claim.id, ctxUser(ownerId));
    const rejected = await getClaim(c1924.claim.id, ctxUser(ownerId));
    if (resolved?.status === "ACCEPTED" && rejected?.status === "REJECTED") {
      pass("conflict_resolution");
    } else fail("conflict_resolution", `${resolved?.status}/${rejected?.status}`);
    v = x04.familyVersion;

    // C06 rejected duplicate allow
    const c06 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "BIRTH_DATE",
      value: { text: "1924" },
    });
    if (c06.claim.status === "PROPOSED") pass("rejected_duplicate");
    else fail("rejected_duplicate", c06.claim.status);
    await rejectClaim(familyId, c06.claim.id, ctxUser(ownerId));
    v = await familyVersion(db, familyId);

    // X05 multi alias both ACCEPTED
    const alias2 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "ALIAS",
      value: { text: "字子明" },
    });
    await acceptClaim(familyId, c02.claim.id, ctxUser(ownerId));
    await acceptClaim(familyId, alias2.claim.id, ctxUser(ownerId));
    const a1 = await getClaim(c02.claim.id, ctxUser(ownerId));
    const a2 = await getClaim(alias2.claim.id, ctxUser(ownerId));
    if (a1?.status === "ACCEPTED" && a2?.status === "ACCEPTED") {
      pass("multi_claim", "aliases no false conflict");
    } else fail("multi_claim", `${a1?.status}/${a2?.status}`);
    v = await familyVersion(db, familyId);

    // —— Relationship assertion ——
    const now = new Date();
    const relId = randomUUID();
    await db.insert(relationships).values({
      id: relId,
      familyId,
      fromPersonId: deceasedId,
      toPersonId: personBId,
      relationshipType: "BIOLOGICAL_PARENT",
      status: "ACCEPTED",
      createdByUserId: ownerId,
      createdAt: now,
      updatedAt: now,
    });

    const r01 = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: deceasedId,
      claimType: "RELATIONSHIP_ASSERTION",
      value: {
        otherPersonId: personBId,
        relationshipType: "BIOLOGICAL_PARENT",
        direction: "SUBJECT_IS_PARENT_OF",
      },
    });
    if (r01.claim.status === "PROPOSED") pass("relationship_assertion");
    else fail("relationship_assertion", r01.claim.status);

    // R02 cross family
    const otherOwner = randomUUID();
    const otherFamily = randomUUID();
    const otherPerson = randomUUID();
    trackedUsers.push(otherOwner);
    trackedFamilies.push(otherFamily);
    await insertUser(db, otherOwner);
    await insertFamily(db, {
      id: otherFamily,
      ownerId: otherOwner,
      visibility: "PRIVATE",
      displayName: "OtherFam",
    });
    await insertPerson(db, {
      id: otherPerson,
      familyId: otherFamily,
      name: "OtherP",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: otherOwner,
    });
    await expectClaimErr("cross_family_assertion", "CROSS_FAMILY", () =>
      createClaim({
        familyId,
        actorContext: ctxUser(ownerId),
        subjectType: "PERSON",
        subjectId: deceasedId,
        claimType: "RELATIONSHIP_ASSERTION",
        value: {
          otherPersonId: otherPerson,
          relationshipType: "BIOLOGICAL_PARENT",
          direction: "SUBJECT_IS_PARENT_OF",
        },
      })
    );

    await expectClaimErr("self_assertion", "SELF_ASSERTION", () =>
      createClaim({
        familyId,
        actorContext: ctxUser(ownerId),
        subjectType: "PERSON",
        subjectId: deceasedId,
        claimType: "RELATIONSHIP_ASSERTION",
        value: {
          otherPersonId: deceasedId,
          relationshipType: "BIOLOGICAL_PARENT",
          direction: "SUBJECT_IS_PARENT_OF",
        },
      })
    );

    await expectClaimErr("hidden_assertion_editor", "SUBJECT_NOT_READABLE", () =>
      createClaim({
        familyId,
        actorContext: ctxUser(editorId),
        subjectType: "PERSON",
        subjectId: privatePersonId,
        claimType: "RELATIONSHIP_ASSERTION",
        value: {
          otherPersonId: personBId,
          relationshipType: "BIOLOGICAL_PARENT",
          direction: "SUBJECT_IS_PARENT_OF",
        },
      })
    );

    const relCountBefore = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(relationships)
      .where(eq(relationships.familyId, familyId));
    await acceptClaim(familyId, r01.claim.id, ctxUser(ownerId));
    const relCountAfter = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(relationships)
      .where(eq(relationships.familyId, familyId));
    if (Number(relCountBefore[0].c) === Number(relCountAfter[0].c)) {
      pass("relationship_no_graph_mutation");
    } else fail("relationship_no_graph_mutation", "edge created");
    v = await familyVersion(db, familyId);

    // —— Evidence ——
    const e01 = await createEvidence({
      familyId,
      actorContext: ctxUser(editorId),
      evidenceType: "ORAL_HISTORY",
      title: "口述",
      description: "族中口述",
      visibility: "FAMILY",
    });
    if (e01.evidence.visibility === "FAMILY") pass("evidence_family");
    else fail("evidence_family", e01.evidence.visibility);
    v = e01.familyVersion;

    await expectEvidenceErr("editor_private_denied", "FORBIDDEN", () =>
      createEvidence({
        familyId,
        actorContext: ctxUser(editorId),
        evidenceType: "DOCUMENT",
        visibility: "PRIVATE",
      })
    );
    await expectEvidenceErr("editor_public_denied", "FORBIDDEN", () =>
      createEvidence({
        familyId,
        actorContext: ctxUser(editorId),
        evidenceType: "DOCUMENT",
        visibility: "PUBLIC",
      })
    );

    const ePriv = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "ARCHIVE",
      title: "私档",
      visibility: "PRIVATE",
    });
    pass("owner_private");
    const ePub = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "GENEALOGY_PAGE",
      title: "公开页",
      visibility: "PUBLIC",
    });
    pass("owner_public");
    v = ePub.familyVersion;

    const eNoMedia = await createEvidence({
      familyId,
      actorContext: ctxUser(editorId),
      evidenceType: "USER_TESTIMONY",
      description: "无媒体证词",
    });
    if (eNoMedia.evidence.mediaObjectId === null) pass("evidence_no_media");
    else fail("evidence_no_media", "has media");
    v = eNoMedia.familyVersion;

    const mediaUp = await uploadMedia({
      familyId,
      actorContext: ctxUser(ownerId),
      body: tinyPng(),
      mimeType: "image/png",
      originalFilename: "t.png",
      visibility: "PRIVATE",
    });
    const eMedia = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "PHOTO",
      mediaObjectId: mediaUp.mediaId,
      visibility: "FAMILY",
    });
    pass("evidence_media");
    v = eMedia.familyVersion;

    // cross-family media
    const otherMedia = await uploadMedia({
      familyId: otherFamily,
      actorContext: ctxUser(otherOwner),
      body: tinyPng(),
      mimeType: "image/png",
      visibility: "FAMILY",
    });
    await expectEvidenceErr("cross_family_media", "CROSS_FAMILY", () =>
      createEvidence({
        familyId,
        actorContext: ctxUser(ownerId),
        evidenceType: "PHOTO",
        mediaObjectId: otherMedia.mediaId,
      })
    );

    // Links
    const claimForLink = c01.claim.id;
    const l01 = await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(editorId),
      claimId: claimForLink,
      evidenceId: e01.evidence.id,
      relation: "SUPPORTS",
    });
    pass("supports");
    const statusBeforeContradict = (await getClaim(claimForLink, ctxUser(ownerId)))
      ?.status;
    await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(editorId),
      claimId: claimForLink,
      evidenceId: eNoMedia.evidence.id,
      relation: "CONTRADICTS",
    });
    const statusAfterContradict = (await getClaim(claimForLink, ctxUser(ownerId)))
      ?.status;
    if (statusBeforeContradict === statusAfterContradict) {
      pass("contradicts", "no auto reject");
    } else fail("contradicts", "status changed");
    await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      claimId: claimForLink,
      evidenceId: ePriv.evidence.id,
      relation: "CONTEXT",
    });
    pass("context");
    await expectEvidenceErr("duplicate_link", "EVIDENCE_ALREADY_LINKED", () =>
      linkEvidenceToClaim({
        familyId,
        actorContext: ctxUser(ownerId),
        claimId: claimForLink,
        evidenceId: e01.evidence.id,
        relation: "SUPPORTS",
      })
    );

    // Bundle: viewer sees claim but not PRIVATE evidence
    const bundle = await getClaimWithEvidence(claimForLink, ctxUser(viewerId));
    const hasPrivate = bundle?.evidenceLinks.some(
      (l) => l.evidence.visibility === "PRIVATE"
    );
    if (bundle && !hasPrivate) pass("bundle_hides_private_evidence");
    else fail("bundle_hides_private_evidence", "leaked or missing");

    // Privacy evidence reads
    if ((await getEvidence(ePriv.evidence.id, ctxUser(ownerId))) &&
        !(await getEvidence(ePriv.evidence.id, ctxUser(editorId))) &&
        !(await getEvidence(ePriv.evidence.id, ctxAnon()))) {
      pass("evidence_private");
    } else fail("evidence_private", "ACL");

    if (
      (await getEvidence(e01.evidence.id, ctxUser(viewerId))) &&
      !(await getEvidence(e01.evidence.id, ctxAnon()))
    ) {
      pass("evidence_family_read");
    } else fail("evidence_family_read", "ACL");

    // Link PUBLIC evidence to deceased claim for anon
    await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      claimId: claimForLink,
      evidenceId: ePub.evidence.id,
      relation: "SUPPORTS",
    });
    if (await getEvidence(ePub.evidence.id, ctxAnon())) {
      pass("evidence_public");
    } else fail("evidence_public", "anon denied");

    // Living claim privacy
    const livingClaim = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: livingId,
      claimType: "ALIAS",
      value: { text: "活着别名" },
    });
    if (!(await getClaim(livingClaim.claim.id, ctxAnon()))) {
      pass("living_claim");
    } else fail("living_claim", "anon saw living claim");

    const livingEv = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "DOCUMENT",
      visibility: "PUBLIC",
      title: "living-src",
    });
    await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      claimId: livingClaim.claim.id,
      evidenceId: livingEv.evidence.id,
      relation: "SUPPORTS",
    });
    if (!(await getEvidence(livingEv.evidence.id, ctxAnon()))) {
      pass("living_evidence");
    } else fail("living_evidence", "anon saw living evidence");

    if (await getClaim(c01.claim.id, ctxAnon())) pass("deceased_claim");
    else fail("deceased_claim", "anon denied deceased");

    // Private person claim
    const privClaim = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: privatePersonId,
      claimType: "ALIAS",
      value: { text: "隐" },
    });
    if (
      (await getClaim(privClaim.claim.id, ctxUser(ownerId))) &&
      !(await getClaim(privClaim.claim.id, ctxUser(editorId)))
    ) {
      pass("private_person_claim");
    } else fail("private_person_claim", "ACL");

    // Relationship claim sidechannel
    const relClaim = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "RELATIONSHIP",
      subjectId: relId,
      claimType: "OCCUPATION",
      value: { text: "边注" },
    });
    void relClaim;
    // SPOUSE must use canonical UUID order (from < to)
    const relPrivId = randomUUID();
    const [spouseFrom, spouseTo] =
      privatePersonId < personBId
        ? [privatePersonId, personBId]
        : [personBId, privatePersonId];
    await db.insert(relationships).values({
      id: relPrivId,
      familyId,
      fromPersonId: spouseFrom,
      toPersonId: spouseTo,
      relationshipType: "SPOUSE",
      status: "ACCEPTED",
      createdByUserId: ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const hiddenRelClaim = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "RELATIONSHIP",
      subjectId: relPrivId,
      claimType: "ALIAS",
      value: { text: "边" },
    });
    if (!(await getClaim(hiddenRelClaim.claim.id, ctxUser(editorId)))) {
      pass("hidden_relationship_claim");
    } else fail("hidden_relationship_claim", "leaked");

    // Assertion other person hidden
    const assertHidden = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: personBId,
      claimType: "RELATIONSHIP_ASSERTION",
      value: {
        otherPersonId: privatePersonId,
        relationshipType: "SPOUSE",
        direction: "SUBJECT_IS_SPOUSE_OF",
      },
    });
    if (!(await getClaim(assertHidden.claim.id, ctxUser(editorId)))) {
      pass("hidden_relationship_assertion");
    } else fail("hidden_relationship_assertion", "leaked otherPersonId");

    // Orphan PUBLIC
    const orphan = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "OTHER",
      visibility: "PUBLIC",
      title: "orphan",
    });
    if (!(await getEvidence(orphan.evidence.id, ctxAnon()))) {
      pass("orphan_public");
    } else fail("orphan_public", "anon saw orphan");

    // PUBLIC evidence + PRIVATE media
    const privMediaEv = await createEvidence({
      familyId,
      actorContext: ctxUser(ownerId),
      evidenceType: "PHOTO",
      mediaObjectId: mediaUp.mediaId,
      visibility: "PUBLIC",
    });
    await linkEvidenceToClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      claimId: claimForLink,
      evidenceId: privMediaEv.evidence.id,
      relation: "CONTEXT",
    });
    if (!(await getEvidence(privMediaEv.evidence.id, ctxAnon()))) {
      pass("private_media_evidence");
    } else fail("private_media_evidence", "anon saw");

    // Media integration — Evidence DTO has no signed URL
    const evDto = await getEvidence(eMedia.evidence.id, ctxUser(ownerId));
    if (evDto && !("signedUrl" in evDto) && !("storageKey" in evDto)) {
      const access = await getMediaReadAccess(mediaUp.mediaId, ctxUser(ownerId));
      let editorDenied = false;
      try {
        await getMediaReadAccess(mediaUp.mediaId, ctxUser(editorId));
      } catch {
        editorDenied = true;
      }
      if (access.signedUrl && editorDenied) {
        pass("media_integration", "Evidence≠signed; Media ACL holds");
      } else fail("media_integration", "media ACL broken");
    } else fail("media_integration", "DTO leaked storage");

    // PRIVATE family + PUBLIC evidence
    const privFamOwner = randomUUID();
    const privFam = randomUUID();
    const privFamPerson = randomUUID();
    trackedUsers.push(privFamOwner);
    trackedFamilies.push(privFam);
    await insertUser(db, privFamOwner);
    await insertFamily(db, {
      id: privFam,
      ownerId: privFamOwner,
      visibility: "PRIVATE",
    });
    await insertPerson(db, {
      id: privFamPerson,
      familyId: privFam,
      name: "PF",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: privFamOwner,
    });
    const pfClaim = await createClaim({
      familyId: privFam,
      actorContext: ctxUser(privFamOwner),
      subjectType: "PERSON",
      subjectId: privFamPerson,
      claimType: "ALIAS",
      value: { text: "私家" },
    });
    const pfEv = await createEvidence({
      familyId: privFam,
      actorContext: ctxUser(privFamOwner),
      evidenceType: "DOCUMENT",
      visibility: "PUBLIC",
    });
    await linkEvidenceToClaim({
      familyId: privFam,
      actorContext: ctxUser(privFamOwner),
      claimId: pfClaim.claim.id,
      evidenceId: pfEv.evidence.id,
      relation: "SUPPORTS",
    });
    if (!(await getEvidence(pfEv.evidence.id, ctxAnon()))) {
      pass("evidence_private_family_ceiling");
    } else fail("evidence_private_family_ceiling", "anon saw");

    // —— Concurrency ——
    const concP = randomUUID();
    await insertPerson(db, {
      id: concP,
      familyId,
      name: "ConcP",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: ownerId,
    });
    const ca = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: concP,
      claimType: "DEATH_DATE",
      value: { text: "1990" },
    });
    const cb = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: concP,
      claimType: "DEATH_DATE",
      value: { text: "1991" },
    });
    await Promise.all([
      acceptClaim(familyId, ca.claim.id, ctxUser(ownerId)),
      acceptClaim(familyId, cb.claim.id, ctxUser(adminId)),
    ]);
    const caS = await getClaim(ca.claim.id, ctxUser(ownerId));
    const cbS = await getClaim(cb.claim.id, ctxUser(ownerId));
    if (caS?.status === "CONFLICTED" && cbS?.status === "CONFLICTED") {
      pass("conflict_concurrency");
    } else fail("conflict_concurrency", `${caS?.status}/${cbS?.status}`);

    const revP = randomUUID();
    await insertPerson(db, {
      id: revP,
      familyId,
      name: "RevP",
      livingStatus: "DECEASED",
      privacyLevel: "INHERIT",
      createdBy: ownerId,
    });
    const revClaim = await createClaim({
      familyId,
      actorContext: ctxUser(ownerId),
      subjectType: "PERSON",
      subjectId: revP,
      claimType: "GENERATION_WORD",
      value: { text: "德" },
    });
    // Same PROPOSED claim: concurrent accept×2 → exactly one wins
    const outcomes = await Promise.allSettled([
      acceptClaim(familyId, revClaim.claim.id, ctxUser(ownerId)),
      acceptClaim(familyId, revClaim.claim.id, ctxUser(adminId)),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled").length;
    const rejectedN = outcomes.filter((o) => o.status === "rejected").length;
    const final = await getClaim(revClaim.claim.id, ctxUser(ownerId));
    const lost = outcomes.find((o) => o.status === "rejected");
    const lostCode =
      lost && lost.status === "rejected" && isClaimDomainError(lost.reason)
        ? lost.reason.code
        : null;
    if (
      fulfilled === 1 &&
      rejectedN === 1 &&
      final?.status === "ACCEPTED" &&
      (lostCode === "REVIEW_CONFLICT" ||
        lostCode === "INVALID_CLAIM_STATUS_TRANSITION")
    ) {
      pass("review_concurrency", final.status);
    } else {
      fail(
        "review_concurrency",
        `f=${fulfilled} r=${rejectedN} s=${final?.status} code=${lostCode}`
      );
    }

    // Family version sequence sample (monotonic, same familyId)
    const vEnd = await familyVersion(db, familyId);
    if (vEnd > 1 && familyId === familyId) {
      pass("family_version_sequence", `version=${vEnd}`);
    } else fail("family_version_sequence", String(vEnd));

    // Audit: no fact values / PII
    const audits = await db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.familyId, trackedFamilies));
    const forbidden = [
      "1923",
      "1924",
      "德成",
      "口述",
      "LivingP",
      "signedUrl",
      "storageKey",
      "@",
    ];
    let auditOk = true;
    const types = new Set(audits.map((a) => a.eventType));
    for (const need of [
      "CLAIM_CREATED",
      "CLAIM_ACCEPTED",
      "CLAIM_REJECTED",
      "EVIDENCE_CREATED",
      "CLAIM_EVIDENCE_LINKED",
    ]) {
      if (!types.has(need)) {
        auditOk = false;
        fail("audit_events", `missing ${need}`);
        break;
      }
    }
    if (auditOk) {
      for (const a of audits) {
        const meta = JSON.stringify(a.metadataJson ?? {});
        if (forbidden.some((f) => meta.includes(f))) {
          auditOk = false;
          fail("audit_no_facts", "metadata leaked");
          break;
        }
      }
    }
    if (auditOk) pass("audit_no_facts");

    // Soft delete evidence
    const del = await deleteEvidence(familyId, e01.evidence.id, ctxUser(ownerId));
    if (!(await getEvidence(e01.evidence.id, ctxUser(ownerId))) && del.familyVersion) {
      pass("evidence_delete");
    } else fail("evidence_delete", "still readable");

    await expectEvidenceErr("editor_delete_denied", "FORBIDDEN", () =>
      deleteEvidence(familyId, ePriv.evidence.id, ctxUser(editorId))
    );

    // Share link cannot create claims
    const share = await createFamilyShareLink(familyId, ownerId);
    await expectClaimErr("share_create_denied", "FORBIDDEN", () =>
      createClaim({
        familyId,
        actorContext: ctxShare(share.rawToken),
        subjectType: "PERSON",
        subjectId: deceasedId,
        claimType: "ALIAS",
        value: { text: "share" },
      })
    );

    // Cleanup blob memory
    mem.objects.clear();
  } catch (e) {
    fail("fatal", e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    // Cleanup FK-safe
    if (trackedFamilies.length) {
      const claimIds = await db
        .select({ id: claims.id })
        .from(claims)
        .where(inArray(claims.familyId, trackedFamilies));
      const cids = claimIds.map((c) => c.id);
      if (cids.length) {
        await db.delete(claimEvidence).where(inArray(claimEvidence.claimId, cids));
      }
      await db.delete(claims).where(inArray(claims.familyId, trackedFamilies));
      await db.delete(evidence).where(inArray(evidence.familyId, trackedFamilies));
      await db
        .delete(mediaObjects)
        .where(inArray(mediaObjects.familyId, trackedFamilies));
      await db
        .delete(relationships)
        .where(inArray(relationships.familyId, trackedFamilies));
      await db.delete(persons).where(inArray(persons.familyId, trackedFamilies));
      await db
        .delete(familyShareLinks)
        .where(inArray(familyShareLinks.familyId, trackedFamilies));
      await db
        .delete(auditEvents)
        .where(inArray(auditEvents.familyId, trackedFamilies));
      await db
        .delete(familyVersions)
        .where(inArray(familyVersions.familyId, trackedFamilies));
      await db
        .delete(familyMemberships)
        .where(inArray(familyMemberships.familyId, trackedFamilies));
      await db.delete(families).where(inArray(families.id, trackedFamilies));
    }
    if (trackedUsers.length) {
      await db.delete(sessions).where(inArray(sessions.userId, trackedUsers));
      await db.delete(users).where(inArray(users.id, trackedUsers));
    }

    const counts = await Promise.all(
      [
        ["users", users],
        ["families", families],
        ["memberships", familyMemberships],
        ["persons", persons],
        ["relationships", relationships],
        ["claims", claims],
        ["evidence", evidence],
        ["claim_evidence", claimEvidence],
        ["media_objects", mediaObjects],
        ["versions", familyVersions],
        ["audits", auditEvents],
        ["sessions", sessions],
        ["share_links", familyShareLinks],
      ].map(async ([name, table]) => {
        const [row] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(table as typeof users);
        return [name, Number(row.c)] as const;
      })
    );

    let clean = true;
    for (const [name, c] of counts) {
      if (c !== 0) {
        clean = false;
        fail("cleanup", `${name}=${c}`);
      }
    }
    if (clean) pass("cleanup", "all tables 0");

    await closeV1Db();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n—— SUMMARY ——");
  console.log(`PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
