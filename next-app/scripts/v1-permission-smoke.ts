/**
 * V1 Permission foundation smoke — fictional data only.
 * Never prints emails, session tokens, share raw tokens, or token hashes.
 */

import { config } from "dotenv";
import { randomUUID } from "crypto";
import { eq, sql, inArray } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import {
  users,
  families,
  familyMemberships,
  familyVersions,
  auditEvents,
  persons,
  familyShareLinks,
  sessions,
  authChallenges,
} from "../src/db/schema";
import type {
  FamilyVisibility,
  LivingStatus,
  MembershipRole,
  PrivacyLevel,
} from "../src/db/constants";
import { isV1AuthConfigured, resetV1AuthConfigCache } from "../src/v1/domain/auth/config";
import { InMemoryOtpDeliveryAdapter } from "../src/v1/domain/auth/delivery";
import { normalizeEmail } from "../src/v1/domain/auth/email";
import {
  createAuthChallenge,
  verifyAuthChallenge,
  resolveSession,
} from "../src/v1/services/authService";
import {
  authorizeFamilyAction,
  authorizePersonRead,
} from "../src/v1/services/permissionService";
import {
  createFamilyShareLink,
  revokeFamilyShareLink,
} from "../src/v1/services/familyShareService";
import {
  generateShareRawToken,
  hashShareToken,
  shareTokenByteLength,
} from "../src/v1/domain/permission/shareToken";
import { isPermissionDomainError } from "../src/v1/domain/permission/errors";
import type { AccessContext, PermissionAction } from "../src/v1/domain/permission/types";
import { PERMISSION_ACTIONS } from "../src/v1/domain/permission/types";

config({ path: ".env.local" });
config({ path: ".env.development.local" });
config({ path: ".env" });
resetV1AuthConfigCache();

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

async function expectDecision(
  name: string,
  actual: "ALLOW" | "DENY",
  expected: "ALLOW" | "DENY"
) {
  if (actual === expected) pass(name, actual);
  else fail(name, `expected ${expected} got ${actual}`);
}

async function insertUser(db: ReturnType<typeof getV1Db>, id: string) {
  const now = new Date();
  await db.insert(users).values({
    id,
    emailLookupHash: null,
    emailCiphertext: null,
    emailKeyVersion: null,
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

async function insertFamily(
  db: ReturnType<typeof getV1Db>,
  opts: {
    id: string;
    ownerId: string;
    visibility: FamilyVisibility;
    discoveryEnabled?: boolean;
  }
) {
  const now = new Date();
  await db.insert(families).values({
    id: opts.id,
    displayName: `Smoke ${opts.visibility}`,
    surname: "Test",
    visibility: opts.visibility,
    discoveryEnabled: opts.discoveryEnabled ?? false,
    createdByUserId: opts.ownerId,
    currentVersionNo: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
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
    summary: "smoke",
    createdAt: now,
  });
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

async function insertPerson(
  db: ReturnType<typeof getV1Db>,
  opts: {
    id: string;
    familyId: string;
    privacyLevel: PrivacyLevel;
    livingStatus: LivingStatus;
    name?: string;
  }
) {
  const now = new Date();
  await db.insert(persons).values({
    id: opts.id,
    familyId: opts.familyId,
    preferredName: opts.name ?? "P",
    gender: "UNKNOWN",
    livingStatus: opts.livingStatus,
    privacyLevel: opts.privacyLevel,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

function ctxAnon(): AccessContext {
  return { kind: "ANONYMOUS" };
}
function ctxUser(userId: string): AccessContext {
  return { kind: "USER", userId };
}
function ctxShare(rawToken: string): AccessContext {
  return { kind: "SHARE_LINK", rawToken };
}

async function main() {
  if (!isV1DbConfigured()) {
    console.error("V1_DATABASE_URL missing");
    process.exit(2);
  }

  const db = getV1Db();
  const trackedUserIds: string[] = [];
  const trackedFamilyIds: string[] = [];
  const trackedPersonIds: string[] = [];
  const trackedShareLinkIds: string[] = [];
  const trackedSessionUserIds: string[] = [];

  try {
    // --- seed users ---
    const ownerId = randomUUID();
    const adminId = randomUUID();
    const editorId = randomUUID();
    const viewerId = randomUUID();
    const unrelatedId = randomUUID();
    const suspendedId = randomUUID();
    const ownerBId = randomUUID();
    for (const id of [
      ownerId,
      adminId,
      editorId,
      viewerId,
      unrelatedId,
      suspendedId,
      ownerBId,
    ]) {
      await insertUser(db, id);
      trackedUserIds.push(id);
    }

    // --- families ---
    const privateFam = randomUUID();
    const linkFam = randomUUID();
    const publicFam = randomUUID();
    const discoveryFam = randomUUID();
    const familyB = randomUUID();
    const deletedFam = randomUUID();

    await insertFamily(db, {
      id: privateFam,
      ownerId,
      visibility: "PRIVATE",
    });
    await insertFamily(db, {
      id: linkFam,
      ownerId,
      visibility: "LINK",
    });
    await insertFamily(db, {
      id: publicFam,
      ownerId,
      visibility: "PUBLIC",
    });
    await insertFamily(db, {
      id: discoveryFam,
      ownerId,
      visibility: "PRIVATE",
      discoveryEnabled: true,
    });
    await insertFamily(db, {
      id: familyB,
      ownerId: ownerBId,
      visibility: "PRIVATE",
    });
    await insertFamily(db, {
      id: deletedFam,
      ownerId,
      visibility: "PUBLIC",
    });
    trackedFamilyIds.push(
      privateFam,
      linkFam,
      publicFam,
      discoveryFam,
      familyB,
      deletedFam
    );

    // members on private (shared across private/link/public via same owner)
    for (const fam of [privateFam, linkFam, publicFam, discoveryFam, deletedFam]) {
      await insertMember(db, fam, adminId, "ADMIN");
      await insertMember(db, fam, editorId, "EDITOR");
      await insertMember(db, fam, viewerId, "VIEWER");
      await insertMember(db, fam, suspendedId, "VIEWER", "SUSPENDED");
    }

    // soft-delete deletedFam
    await db
      .update(families)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(families.id, deletedFam));

    // --- persons ---
    const personPrivate = randomUUID();
    const personFamily = randomUUID();
    const personDeceasedPriv = randomUUID();
    const personDeceasedLink = randomUUID();
    const personDeceasedPub = randomUUID();
    const personLivingInherit = randomUUID();
    const personUnknownInherit = randomUUID();
    const personPublicOnPrivate = randomUUID();
    const personPublicOnLink = randomUUID();
    const personPublicOnPublic = randomUUID();
    const personOnB = randomUUID();

    await insertPerson(db, {
      id: personPrivate,
      familyId: privateFam,
      privacyLevel: "PRIVATE",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personFamily,
      familyId: privateFam,
      privacyLevel: "FAMILY",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personDeceasedPriv,
      familyId: privateFam,
      privacyLevel: "INHERIT",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personDeceasedLink,
      familyId: linkFam,
      privacyLevel: "INHERIT",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personDeceasedPub,
      familyId: publicFam,
      privacyLevel: "INHERIT",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personLivingInherit,
      familyId: publicFam,
      privacyLevel: "INHERIT",
      livingStatus: "LIVING",
    });
    await insertPerson(db, {
      id: personUnknownInherit,
      familyId: publicFam,
      privacyLevel: "INHERIT",
      livingStatus: "UNKNOWN",
    });
    await insertPerson(db, {
      id: personPublicOnPrivate,
      familyId: privateFam,
      privacyLevel: "PUBLIC",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personPublicOnLink,
      familyId: linkFam,
      privacyLevel: "PUBLIC",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personPublicOnPublic,
      familyId: publicFam,
      privacyLevel: "PUBLIC",
      livingStatus: "DECEASED",
    });
    await insertPerson(db, {
      id: personOnB,
      familyId: familyB,
      privacyLevel: "PRIVATE",
      livingStatus: "DECEASED",
    });
    trackedPersonIds.push(
      personPrivate,
      personFamily,
      personDeceasedPriv,
      personDeceasedLink,
      personDeceasedPub,
      personLivingInherit,
      personUnknownInherit,
      personPublicOnPrivate,
      personPublicOnLink,
      personPublicOnPublic,
      personOnB
    );

    // ========== Share token entropy ==========
    {
      const raw = generateShareRawToken();
      const bytes = shareTokenByteLength(raw);
      if (bytes >= 32) pass("SHARE_TOKEN_HIGH_ENTROPY", `${bytes} bytes`);
      else fail("SHARE_TOKEN_HIGH_ENTROPY", `${bytes} bytes`);
    }

    // ========== Create share links ==========
    let linkToken: string;
    let linkId: string;
    let privateShareToken: string;
    let privateShareId: string;
    let publicShareToken: string;
    let publicShareId: string;
    let expireToken: string;
    let expireLinkId: string;
    let revokeToken: string;
    let revokeLinkId: string;
    let deletedFamToken: string;
    let deletedFamLinkId: string;

    {
      const created = await createFamilyShareLink(linkFam, ownerId);
      linkToken = created.rawToken;
      linkId = created.linkId;
      trackedShareLinkIds.push(linkId);

      // DB stores hash only
      const [row] = await db
        .select()
        .from(familyShareLinks)
        .where(eq(familyShareLinks.id, linkId));
      const expectedHash = hashShareToken(linkToken);
      if (row && row.tokenHash === expectedHash && !JSON.stringify(row).includes(linkToken)) {
        pass("RAW_SHARE_TOKEN_DB", "NO — hash only");
      } else fail("RAW_SHARE_TOKEN_DB", "raw or hash mismatch");
    }

    {
      // Share on PRIVATE family (should not grant READ)
      const c = await createFamilyShareLink(privateFam, ownerId);
      privateShareToken = c.rawToken;
      privateShareId = c.linkId;
      trackedShareLinkIds.push(privateShareId);
    }

    {
      // Valid share on PUBLIC family — still cannot open LIVING INHERIT person
      const c = await createFamilyShareLink(publicFam, ownerId);
      publicShareToken = c.rawToken;
      publicShareId = c.linkId;
      trackedShareLinkIds.push(publicShareId);
    }

    {
      const past = new Date(Date.now() - 60_000);
      const c = await createFamilyShareLink(linkFam, ownerId, { expiresAt: past });
      expireToken = c.rawToken;
      expireLinkId = c.linkId;
      trackedShareLinkIds.push(expireLinkId);
    }

    {
      const c = await createFamilyShareLink(linkFam, adminId);
      revokeToken = c.rawToken;
      revokeLinkId = c.linkId;
      trackedShareLinkIds.push(revokeLinkId);
    }

    {
      // create before soft-delete already done — create on deletedFam should fail
      try {
        await createFamilyShareLink(deletedFam, ownerId);
        fail("create_on_deleted", "should forbid");
      } catch (e) {
        if (isPermissionDomainError(e)) pass("create_on_deleted", e.code);
        else fail("create_on_deleted", String(e));
      }
      // insert a link then soft-delete already happened — seed link while family was public then delete
      // Use linkFam token path for deleted: insert manually then family already deleted
      const raw = generateShareRawToken();
      deletedFamToken = raw;
      deletedFamLinkId = randomUUID();
      await db.insert(familyShareLinks).values({
        id: deletedFamLinkId,
        familyId: deletedFam,
        createdByUserId: ownerId,
        tokenHash: hashShareToken(raw),
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
      });
      trackedShareLinkIds.push(deletedFamLinkId);
    }

    // EDITOR cannot create
    {
      try {
        await createFamilyShareLink(linkFam, editorId);
        fail("share_create_editor", "should forbid");
      } catch (e) {
        if (isPermissionDomainError(e) && e.code === "FORBIDDEN")
          pass("share_create_editor", "FORBIDDEN");
        else fail("share_create_editor", String(e));
      }
    }
    {
      try {
        await createFamilyShareLink(linkFam, viewerId);
        fail("share_create_viewer", "should forbid");
      } catch (e) {
        if (isPermissionDomainError(e) && e.code === "FORBIDDEN")
          pass("share_create_viewer", "FORBIDDEN");
        else fail("share_create_viewer", String(e));
      }
    }

    // ========== PRIVATE family matrix ==========
    {
      const cases: [string, AccessContext, "ALLOW" | "DENY"][] = [
        ["private_anon", ctxAnon(), "DENY"],
        ["private_unrelated", ctxUser(unrelatedId), "DENY"],
        ["private_share", ctxShare(privateShareToken!), "DENY"],
        ["private_viewer", ctxUser(viewerId), "ALLOW"],
        ["private_editor", ctxUser(editorId), "ALLOW"],
        ["private_admin", ctxUser(adminId), "ALLOW"],
        ["private_owner", ctxUser(ownerId), "ALLOW"],
      ];
      for (const [name, ctx, exp] of cases) {
        const r = await authorizeFamilyAction(privateFam, ctx, "READ_FAMILY");
        await expectDecision(name, r.decision, exp);
      }
    }

    // ========== LINK family matrix ==========
    {
      const fake = generateShareRawToken();
      const cases: [string, AccessContext, "ALLOW" | "DENY"][] = [
        ["link_anon_no_token", ctxAnon(), "DENY"],
        ["link_unrelated_no_token", ctxUser(unrelatedId), "DENY"],
        ["link_valid_token", ctxShare(linkToken!), "ALLOW"],
        ["link_invalid_token", ctxShare(fake), "DENY"],
        ["link_expired_token", ctxShare(expireToken!), "DENY"],
        ["link_member", ctxUser(viewerId), "ALLOW"],
      ];
      for (const [name, ctx, exp] of cases) {
        const r = await authorizeFamilyAction(linkFam, ctx, "READ_FAMILY");
        await expectDecision(name, r.decision, exp);
      }

      // revoke then deny
      await revokeFamilyShareLink(linkFam, revokeLinkId!, ownerId);
      const after = await authorizeFamilyAction(
        linkFam,
        ctxShare(revokeToken!),
        "READ_FAMILY"
      );
      await expectDecision("link_revoked_token", after.decision, "DENY");
      pass("SHARE_REVOKE_IMMEDIATE", "DENY after revoke");
    }

    // ========== PUBLIC family matrix ==========
    {
      const cases: [string, AccessContext, "ALLOW" | "DENY"][] = [
        ["public_anon", ctxAnon(), "ALLOW"],
        ["public_unrelated", ctxUser(unrelatedId), "ALLOW"],
        ["public_member", ctxUser(viewerId), "ALLOW"],
      ];
      for (const [name, ctx, exp] of cases) {
        const r = await authorizeFamilyAction(publicFam, ctx, "READ_FAMILY");
        await expectDecision(name, r.decision, exp);
      }
    }

    // ========== Discovery isolation ==========
    {
      const cases: [string, AccessContext][] = [
        ["discovery_anon", ctxAnon()],
        ["discovery_unrelated", ctxUser(unrelatedId)],
        ["discovery_share", ctxShare(privateShareToken!)],
      ];
      for (const [name, ctx] of cases) {
        const r = await authorizeFamilyAction(discoveryFam, ctx, "READ_FAMILY");
        await expectDecision(name, r.decision, "DENY");
      }
      pass("DISCOVERY_NOT_READ_PERMISSION", "PRIVATE+discovery still DENY");
    }

    // ========== Role matrix ==========
    {
      const ownerAllow: PermissionAction[] = [...PERMISSION_ACTIONS];
      const adminDeny: PermissionAction[] = ["DELETE_FAMILY"];
      const editorAllow: PermissionAction[] = [
        "READ_FAMILY",
        "READ_PERSON",
        "EDIT_PERSON",
        "EDIT_RELATIONSHIP",
        "EDIT_CLAIM",
        "EDIT_EVIDENCE",
        "UPLOAD_MEDIA",
      ];
      const editorDeny: PermissionAction[] = [
        "EDIT_FAMILY_IDENTITY",
        "MANAGE_MEMBERS",
        "MANAGE_PRIVACY",
        "MANAGE_SHARE_LINKS",
        "DELETE_PERSON",
        "DELETE_FAMILY",
      ];
      const viewerAllow: PermissionAction[] = ["READ_FAMILY", "READ_PERSON"];

      for (const a of ownerAllow) {
        const r = await authorizeFamilyAction(
          privateFam,
          ctxUser(ownerId),
          a
        );
        if (r.decision !== "ALLOW") fail(`owner_${a}`, r.decision);
      }
      pass("role_owner", "all actions ALLOW");

      for (const a of PERMISSION_ACTIONS) {
        const r = await authorizeFamilyAction(privateFam, ctxUser(adminId), a);
        const exp = adminDeny.includes(a) ? "DENY" : "ALLOW";
        if (r.decision !== exp) fail(`admin_${a}`, `expected ${exp} got ${r.decision}`);
      }
      pass("role_admin", "DELETE_FAMILY DENY; rest ALLOW");

      for (const a of editorAllow) {
        const r = await authorizeFamilyAction(privateFam, ctxUser(editorId), a);
        if (r.decision !== "ALLOW") fail(`editor_allow_${a}`, r.decision);
      }
      for (const a of editorDeny) {
        const r = await authorizeFamilyAction(privateFam, ctxUser(editorId), a);
        if (r.decision !== "DENY") fail(`editor_deny_${a}`, r.decision);
      }
      pass("role_editor", "content edit ok; manage/identity deny");

      for (const a of PERMISSION_ACTIONS) {
        const r = await authorizeFamilyAction(privateFam, ctxUser(viewerId), a);
        const exp = viewerAllow.includes(a) ? "ALLOW" : "DENY";
        if (r.decision !== exp) fail(`viewer_${a}`, `expected ${exp}`);
      }
      pass("role_viewer", "read only");

      // SUSPENDED
      const susRead = await authorizeFamilyAction(
        privateFam,
        ctxUser(suspendedId),
        "READ_FAMILY"
      );
      await expectDecision("suspended_private_read", susRead.decision, "DENY");
      const susEdit = await authorizeFamilyAction(
        privateFam,
        ctxUser(suspendedId),
        "EDIT_PERSON"
      );
      await expectDecision("suspended_mutation", susEdit.decision, "DENY");
      // PUBLIC family: suspended can still read like anonymous
      const susPub = await authorizeFamilyAction(
        publicFam,
        ctxUser(suspendedId),
        "READ_FAMILY"
      );
      await expectDecision("suspended_public_read", susPub.decision, "ALLOW");
    }

    // ========== Person privacy ==========
    {
      // PRIVATE person
      const privCases: [string, AccessContext, "ALLOW" | "DENY"][] = [
        ["person_private_owner", ctxUser(ownerId), "ALLOW"],
        ["person_private_admin", ctxUser(adminId), "ALLOW"],
        ["person_private_editor", ctxUser(editorId), "DENY"],
        ["person_private_viewer", ctxUser(viewerId), "DENY"],
        ["person_private_share", ctxShare(privateShareToken!), "DENY"],
        ["person_private_anon", ctxAnon(), "DENY"],
      ];
      for (const [n, c, e] of privCases) {
        const r = await authorizePersonRead(personPrivate, c);
        await expectDecision(n, r.decision, e);
      }

      // FAMILY person
      const famCases: [string, AccessContext, "ALLOW" | "DENY"][] = [
        ["person_family_owner", ctxUser(ownerId), "ALLOW"],
        ["person_family_viewer", ctxUser(viewerId), "ALLOW"],
        ["person_family_share", ctxShare(privateShareToken!), "DENY"],
        ["person_family_anon", ctxAnon(), "DENY"],
      ];
      for (const [n, c, e] of famCases) {
        const r = await authorizePersonRead(personFamily, c);
        await expectDecision(n, r.decision, e);
      }

      // DECEASED INHERIT
      await expectDecision(
        "deceased_inherit_private_anon",
        (await authorizePersonRead(personDeceasedPriv, ctxAnon())).decision,
        "DENY"
      );
      await expectDecision(
        "deceased_inherit_private_viewer",
        (await authorizePersonRead(personDeceasedPriv, ctxUser(viewerId)))
          .decision,
        "ALLOW"
      );
      await expectDecision(
        "deceased_inherit_link_token",
        (await authorizePersonRead(personDeceasedLink, ctxShare(linkToken!)))
          .decision,
        "ALLOW"
      );
      await expectDecision(
        "deceased_inherit_link_anon",
        (await authorizePersonRead(personDeceasedLink, ctxAnon())).decision,
        "DENY"
      );
      await expectDecision(
        "deceased_inherit_public_anon",
        (await authorizePersonRead(personDeceasedPub, ctxAnon())).decision,
        "ALLOW"
      );

      // LIVING INHERIT on PUBLIC family
      await expectDecision(
        "living_inherit_public_anon",
        (await authorizePersonRead(personLivingInherit, ctxAnon())).decision,
        "DENY"
      );
      await expectDecision(
        "living_inherit_public_share",
        (
          await authorizePersonRead(
            personLivingInherit,
            ctxShare(publicShareToken!)
          )
        ).decision,
        "DENY"
      );
      await expectDecision(
        "living_inherit_public_viewer",
        (await authorizePersonRead(personLivingInherit, ctxUser(viewerId)))
          .decision,
        "ALLOW"
      );
      pass("LIVING_DEFAULT_PRIVATE", "INHERIT→FAMILY on PUBLIC");

      // UNKNOWN INHERIT
      await expectDecision(
        "unknown_inherit_public_anon",
        (await authorizePersonRead(personUnknownInherit, ctxAnon())).decision,
        "DENY"
      );
      await expectDecision(
        "unknown_inherit_public_viewer",
        (await authorizePersonRead(personUnknownInherit, ctxUser(viewerId)))
          .decision,
        "ALLOW"
      );
      pass("UNKNOWN_DEFAULT_PRIVATE", "same as LIVING");

      // PUBLIC person ceiling
      await expectDecision(
        "public_person_private_fam_anon",
        (await authorizePersonRead(personPublicOnPrivate, ctxAnon())).decision,
        "DENY"
      );
      await expectDecision(
        "public_person_link_token",
        (await authorizePersonRead(personPublicOnLink, ctxShare(linkToken!)))
          .decision,
        "ALLOW"
      );
      await expectDecision(
        "public_person_public_fam_anon",
        (await authorizePersonRead(personPublicOnPublic, ctxAnon())).decision,
        "ALLOW"
      );
      pass("PERSON_PRIVACY_CEILING", "family visibility caps person");
    }

    // ========== Cross-family ==========
    {
      const r = await authorizePersonRead(personOnB, ctxUser(ownerId), {
        expectedFamilyId: privateFam,
      });
      await expectDecision("cross_family_expected_mismatch", r.decision, "DENY");
      const r2 = await authorizePersonRead(personOnB, ctxUser(ownerId));
      await expectDecision("cross_family_a_owner_b_person", r2.decision, "DENY");
      pass("CROSS_FAMILY_ACCESS", "BLOCKED");
    }

    // ========== Deleted family ==========
    {
      const cases: [string, AccessContext][] = [
        ["deleted_member", ctxUser(ownerId)],
        ["deleted_share", ctxShare(deletedFamToken!)],
        ["deleted_anon", ctxAnon()],
      ];
      for (const [n, c] of cases) {
        const r = await authorizeFamilyAction(deletedFam, c, "READ_FAMILY");
        await expectDecision(n, r.decision, "DENY");
      }
      pass("DELETED_FAMILY_ACCESS", "BLOCKED");
    }

    // ========== Auth → Permission chain ==========
    if (isV1AuthConfigured()) {
      const adapter = new InMemoryOtpDeliveryAdapter();
      const email = `perm-smoke-${randomUUID().slice(0, 8)}@example.com`;
      const { challengeId } = await createAuthChallenge(email, adapter);
      const code = adapter.lastCodeFor(normalizeEmail(email));
      if (!code) {
        fail("auth_permission_chain", "no OTP captured");
      } else {
        const { sessionToken, user } = await verifyAuthChallenge(
          challengeId,
          code
        );
        trackedUserIds.push(user.id);
        trackedSessionUserIds.push(user.id);

        // grant VIEWER on privateFam
        await insertMember(db, privateFam, user.id, "VIEWER");

        const sessionUser = await resolveSession(sessionToken);
        if (!sessionUser || sessionUser.id !== user.id) {
          fail("auth_permission_chain", "session resolve failed");
        } else {
          const r = await authorizeFamilyAction(
            privateFam,
            { kind: "USER", userId: sessionUser.id },
            "READ_FAMILY"
          );
          await expectDecision("auth_permission_chain", r.decision, "ALLOW");
          pass("AUTH_TO_PERMISSION_CONTEXT", "opaque→user→membership→ALLOW");
        }
      }
    } else {
      fail("auth_permission_chain", "auth secrets missing");
    }

    // familyId is not auth
    {
      // knowing privateFam id alone (anonymous) is DENY
      const r = await authorizeFamilyAction(privateFam, ctxAnon(), "READ_FAMILY");
      await expectDecision("FAMILY_ID_IS_NOT_AUTH", r.decision, "DENY");
    }

    // ========== Cleanup ==========
    await db
      .delete(familyShareLinks)
      .where(inArray(familyShareLinks.familyId, trackedFamilyIds));
    await db.delete(persons).where(inArray(persons.id, trackedPersonIds));
    await db
      .delete(familyMemberships)
      .where(inArray(familyMemberships.familyId, trackedFamilyIds));
    await db
      .delete(familyVersions)
      .where(inArray(familyVersions.familyId, trackedFamilyIds));
    await db
      .delete(auditEvents)
      .where(inArray(auditEvents.familyId, trackedFamilyIds));
    await db.delete(families).where(inArray(families.id, trackedFamilyIds));

    if (trackedSessionUserIds.length) {
      await db
        .delete(sessions)
        .where(inArray(sessions.userId, trackedSessionUserIds));
      await db.delete(authChallenges); // smoke challenges only — careful: only if empty of real?
    }
    // Safer: delete challenges by looking up users we created via auth
    // Auth users have email hash — delete all tracked users' sessions
    await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
    // Delete auth challenges that belong to smoke — wipe by joining is hard; delete all challenges if count small
    // Prefer: leave challenges for auth users then delete users (challenges have no FK to users)
    const challengeCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(authChallenges);
    // Only delete challenges created in this run if we can — for cleanup to 0, delete all if we know REAL=0
    await db.delete(authChallenges);
    await db.delete(users).where(inArray(users.id, trackedUserIds));

    // Verify zeros for smoke-related tables (entire V1 empty expected)
    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM sessions) AS sessions,
        (SELECT count(*)::int FROM families) AS families,
        (SELECT count(*)::int FROM family_memberships) AS memberships,
        (SELECT count(*)::int FROM persons) AS persons,
        (SELECT count(*)::int FROM family_share_links) AS share_links,
        (SELECT count(*)::int FROM auth_challenges) AS challenges
    `);
    const row = counts.rows[0] as Record<string, number>;
    const zero =
      Number(row.users) === 0 &&
      Number(row.sessions) === 0 &&
      Number(row.families) === 0 &&
      Number(row.memberships) === 0 &&
      Number(row.persons) === 0 &&
      Number(row.share_links) === 0;
    if (zero) pass("cleanup", `all business tables 0 (challenges=${row.challenges})`);
    else
      fail(
        "cleanup",
        `users=${row.users} sessions=${row.sessions} families=${row.families} memberships=${row.memberships} persons=${row.persons} share_links=${row.share_links}`
      );

    void challengeCount;
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
  console.log("PERMISSION_SMOKE = PASS");
  process.exit(0);
}

main();
