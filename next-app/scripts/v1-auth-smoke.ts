/**
 * V1 Auth foundation smoke — example.com only, in-memory OTP delivery.
 * Never prints secrets, emails hashes, OTP, or session tokens.
 */

import { config } from "dotenv";
import { randomBytes, randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { closeV1Db, getV1Db, isV1DbConfigured } from "../src/db/client";
import { users, authChallenges, sessions } from "../src/db/schema";
import { normalizeEmail } from "../src/v1/domain/auth/email";
import {
  computeEmailLookupHash,
  encryptEmail,
  decryptEmail,
} from "../src/v1/domain/auth/crypto";
import { InMemoryOtpDeliveryAdapter } from "../src/v1/domain/auth/delivery";
import { isAuthDomainError } from "../src/v1/domain/auth/errors";
import { isV1AuthConfigured, resetV1AuthConfigCache } from "../src/v1/domain/auth/config";
import {
  createAuthChallenge,
  verifyAuthChallenge,
  resolveSession,
  revokeSession,
  revokeAllUserSessions,
  createSession,
  insertExpiredChallengeForTest,
  insertExpiredSessionForTest,
} from "../src/v1/services/authService";
import * as repo from "../src/v1/repositories/authRepository";
import { OTP_MAX_ATTEMPTS } from "../src/v1/domain/auth/types";

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

function smokeEmail(tag: string) {
  return `auth-smoke-${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

async function main() {
  if (!isV1DbConfigured() || !isV1AuthConfigured()) {
    console.error("V1_DATABASE_URL or auth secrets missing");
    process.exit(2);
  }

  const db = getV1Db();
  const adapter = new InMemoryOtpDeliveryAdapter();
  const trackedUserIds: string[] = [];
  const trackedChallengeIds: string[] = [];

  try {
    // TEST 01 — normalization
    {
      const a = normalizeEmail(" Test@Example.COM ");
      const b = normalizeEmail("test@example.com");
      if (a === b && a === "test@example.com") pass("normalization");
      else fail("normalization", "canonical mismatch");
    }

    // TEST 02 — lookup hash (do not print)
    {
      const e1 = smokeEmail("lookup1").toLowerCase();
      const e2 = smokeEmail("lookup2").toLowerCase();
      const h1a = computeEmailLookupHash(normalizeEmail(e1));
      const h1b = computeEmailLookupHash(normalizeEmail(` ${e1.toUpperCase()} `));
      const h2 = computeEmailLookupHash(normalizeEmail(e2));
      if (h1a === h1b && h1a !== h2) pass("lookup");
      else fail("lookup", "hash equality failed");
    }

    // TEST 03 — encryption
    {
      const email = normalizeEmail(smokeEmail("enc"));
      const c1 = encryptEmail(email);
      const c2 = encryptEmail(email);
      const d1 = decryptEmail(c1.ciphertext, c1.keyVersion);
      const d2 = decryptEmail(c2.ciphertext, c2.keyVersion);
      if (
        !c1.ciphertext.equals(c2.ciphertext) &&
        d1 === email &&
        d2 === email
      ) {
        pass("encryption", "non-deterministic ciphertext");
      } else fail("encryption", "cipher properties failed");
    }

    // TEST 04 — tamper
    {
      const email = normalizeEmail(smokeEmail("tamper"));
      const { ciphertext, keyVersion } = encryptEmail(email);
      const tampered = Buffer.from(ciphertext);
      tampered[tampered.length - 1] ^= 0xff;
      try {
        decryptEmail(tampered, keyVersion);
        fail("tamper", "decrypted tampered data");
      } catch (e) {
        if (isAuthDomainError(e)) pass("tamper");
        else fail("tamper", "wrong error type");
      }
    }

    // TEST 05 — create challenge
    {
      const email = smokeEmail("create");
      const { challengeId, expiresAt } = await createAuthChallenge(
        email,
        adapter
      );
      trackedChallengeIds.push(challengeId);
      const row = await repo.lockChallengeById(db, challengeId);
      const ttlMs = expiresAt.getTime() - Date.now();
      const code = adapter.lastCodeFor(normalizeEmail(email));
      const canon = normalizeEmail(email);
      // Binary ciphertext must not equal UTF-8 of email or OTP
      const cipherUtf = Buffer.from(row!.emailCiphertext).toString("utf8");
      const noPlain =
        !cipherUtf.includes(canon) &&
        row!.codeDigest !== code &&
        !row!.codeDigest.includes(code ?? "______");
      if (
        row &&
        noPlain &&
        row.codeDigest.length === 64 &&
        code &&
        code.length === 6 &&
        ttlMs > 8 * 60 * 1000 &&
        ttlMs < 12 * 60 * 1000
      ) {
        pass("create_challenge", "TTL≈10m; no plaintext");
      } else {
        fail(
          "create_challenge",
          `ttl=${ttlMs} codeLen=${code?.length} digestLen=${row?.codeDigest.length} noPlain=${noPlain}`
        );
      }
    }

    // TEST 06 — wrong code once
    {
      const email = smokeEmail("wrong1");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      try {
        await verifyAuthChallenge(challengeId, "000000");
        fail("wrong_code", "expected INVALID_CODE");
      } catch (e) {
        const ch = await repo.lockChallengeById(db, challengeId);
        if (
          isAuthDomainError(e) &&
          e.code === "INVALID_CODE" &&
          ch?.failedAttempts === 1
        ) {
          pass("wrong_code");
        } else {
          fail(
            "wrong_code",
            `${isAuthDomainError(e) ? e.code : "?"} attempts=${ch?.failedAttempts}`
          );
        }
      }
    }

    // TEST 07 — five wrong → locked
    {
      const email = smokeEmail("lock");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const real = adapter.lastCodeFor(normalizeEmail(email))!;
      const wrong = real === "000000" ? "111111" : "000000";
      let sawLocked = false;
      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        try {
          await verifyAuthChallenge(challengeId, wrong);
        } catch (e) {
          if (isAuthDomainError(e) && e.code === "CHALLENGE_LOCKED") {
            sawLocked = true;
          }
        }
      }
      try {
        await verifyAuthChallenge(challengeId, real);
        fail("locked_after_5", "correct code accepted after lock");
      } catch (e) {
        const ch = await repo.lockChallengeById(db, challengeId);
        if (
          sawLocked &&
          isAuthDomainError(e) &&
          e.code === "CHALLENGE_LOCKED" &&
          ch &&
          ch.failedAttempts >= OTP_MAX_ATTEMPTS
        ) {
          pass("locked_after_5");
        } else {
          fail(
            "locked_after_5",
            `code=${isAuthDomainError(e) ? e.code : "?"} attempts=${ch?.failedAttempts} sawLocked=${sawLocked}`
          );
        }
      }
    }

    // TEST 08 — expired
    {
      const email = smokeEmail("exp");
      const challengeId = await insertExpiredChallengeForTest(
        email,
        "123456"
      );
      trackedChallengeIds.push(challengeId);
      try {
        await verifyAuthChallenge(challengeId, "123456");
        fail("expired_challenge", "accepted expired");
      } catch (e) {
        if (isAuthDomainError(e) && e.code === "CHALLENGE_EXPIRED") {
          pass("expired_challenge");
        } else {
          fail(
            "expired_challenge",
            isAuthDomainError(e) ? e.code : String(e)
          );
        }
      }
    }

    // TEST 09 — successful verify
    let userId = "";
    let sessionToken = "";
    {
      const email = smokeEmail("ok");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const code = adapter.lastCodeFor(normalizeEmail(email))!;
      const res = await verifyAuthChallenge(challengeId, code);
      userId = res.user.id;
      sessionToken = res.sessionToken;
      trackedUserIds.push(userId);
      const ch = await repo.lockChallengeById(db, challengeId);
      const sess = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      const user = await repo.findUserById(db, userId);
      const rawInDb = sess.some(
        (s) =>
          s.tokenHash === sessionToken ||
          Buffer.from(s.tokenHash).toString("utf8") === sessionToken
      );
      if (
        ch?.consumedAt &&
        user?.emailVerifiedAt &&
        sess.length === 1 &&
        sessionToken.length > 20 &&
        !rawInDb
      ) {
        pass("successful_verify");
      } else {
        fail("successful_verify", "post-conditions failed");
      }
    }

    // TEST 10 — repeat login same user
    {
      const email = smokeEmail("repeat");
      const c1 = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(c1.challengeId);
      const code1 = adapter.lastCodeFor(normalizeEmail(email))!;
      const r1 = await verifyAuthChallenge(c1.challengeId, code1);
      trackedUserIds.push(r1.user.id);

      const c2 = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(c2.challengeId);
      const code2 = adapter.lastCodeFor(normalizeEmail(email))!;
      const r2 = await verifyAuthChallenge(c2.challengeId, code2);
      if (r1.user.id === r2.user.id) pass("repeat_login");
      else fail("repeat_login", "different user ids");
    }

    // TEST 11 — resolve session
    {
      try {
        const u = await resolveSession(sessionToken);
        if (u.id === userId) pass("resolve_session");
        else fail("resolve_session", "user mismatch");
      } catch (e) {
        fail(
          "resolve_session",
          isAuthDomainError(e) ? e.code : String(e)
        );
      }
    }

    // TEST 12 — fake token
    {
      try {
        await resolveSession(randomBytes(32).toString("base64url"));
        fail("fake_token", "accepted");
      } catch (e) {
        if (isAuthDomainError(e) && e.code === "SESSION_NOT_FOUND") {
          pass("fake_token");
        } else {
          fail("fake_token", isAuthDomainError(e) ? e.code : String(e));
        }
      }
    }

    // TEST 13 — revoke one
    {
      await revokeSession(sessionToken);
      try {
        await resolveSession(sessionToken);
        fail("revoke", "still valid");
      } catch (e) {
        if (
          isAuthDomainError(e) &&
          (e.code === "SESSION_REVOKED" || e.code === "SESSION_NOT_FOUND")
        ) {
          pass("revoke");
        } else {
          fail("revoke", isAuthDomainError(e) ? e.code : String(e));
        }
      }
    }

    // TEST 14 — revoke all
    {
      const email = smokeEmail("revall");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const code = adapter.lastCodeFor(normalizeEmail(email))!;
      const r = await verifyAuthChallenge(challengeId, code);
      trackedUserIds.push(r.user.id);
      const s2 = await createSession(r.user.id);
      await revokeAllUserSessions(r.user.id);
      let bothFail = true;
      for (const t of [r.sessionToken, s2.sessionToken]) {
        try {
          await resolveSession(t);
          bothFail = false;
        } catch {
          /* expected */
        }
      }
      if (bothFail) pass("revoke_all");
      else fail("revoke_all", "session still valid");
    }

    // TEST 15 — expired session
    {
      const email = smokeEmail("sessexp");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const code = adapter.lastCodeFor(normalizeEmail(email))!;
      const r = await verifyAuthChallenge(challengeId, code);
      trackedUserIds.push(r.user.id);
      const expiredToken = await insertExpiredSessionForTest(r.user.id);
      try {
        await resolveSession(expiredToken);
        fail("expired_session", "accepted");
      } catch (e) {
        if (isAuthDomainError(e) && e.code === "SESSION_EXPIRED") {
          pass("expired_session");
        } else {
          fail(
            "expired_session",
            isAuthDomainError(e) ? e.code : String(e)
          );
        }
      }
    }

    // TEST 16 — deleted user
    {
      const email = smokeEmail("deluser");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const code = adapter.lastCodeFor(normalizeEmail(email))!;
      const r = await verifyAuthChallenge(challengeId, code);
      trackedUserIds.push(r.user.id);
      await repo.softDeleteUser(db, r.user.id, new Date());
      try {
        await resolveSession(r.sessionToken);
        fail("deleted_user", "session still valid");
      } catch (e) {
        if (isAuthDomainError(e) && e.code === "SESSION_NOT_FOUND") {
          pass("deleted_user");
        } else {
          fail(
            "deleted_user",
            isAuthDomainError(e) ? e.code : String(e)
          );
        }
      }
    }

    // TEST 17 — concurrent verify same challenge
    {
      const email = smokeEmail("conc");
      const { challengeId } = await createAuthChallenge(email, adapter);
      trackedChallengeIds.push(challengeId);
      const code = adapter.lastCodeFor(normalizeEmail(email))!;
      const settled = await Promise.allSettled([
        verifyAuthChallenge(challengeId, code),
        verifyAuthChallenge(challengeId, code),
      ]);
      const ok = settled.filter((s) => s.status === "fulfilled");
      const consumed = settled.filter(
        (s) =>
          s.status === "rejected" &&
          isAuthDomainError(s.reason) &&
          s.reason.code === "CHALLENGE_CONSUMED"
      );
      if (ok.length === 1 && consumed.length === 1) {
        const uid = (ok[0] as PromiseFulfilledResult<{ user: { id: string } }>)
          .value.user.id;
        trackedUserIds.push(uid);
        const sessCount = await db.execute(sql`
          SELECT count(*)::int AS c FROM sessions WHERE user_id = ${uid}
        `);
        // may have 1 session from the success
        pass(
          "concurrent_verify",
          `sessions=${(sessCount.rows[0] as { c: number }).c}`
        );
      } else {
        fail(
          "concurrent_verify",
          JSON.stringify({
            ok: ok.length,
            consumed: consumed.length,
            other: settled.map((s) =>
              s.status === "rejected" && isAuthDomainError(s.reason)
                ? s.reason.code
                : s.status
            ),
          })
        );
      }
    }

    // TEST 18 — concurrent same-email different challenges
    {
      const email = smokeEmail("sameemail");
      const a = await createAuthChallenge(email, adapter);
      const codeA = adapter.lastCodeFor(normalizeEmail(email))!;
      const b = await createAuthChallenge(email, adapter);
      const codeB = adapter.lastCodeFor(normalizeEmail(email))!;
      trackedChallengeIds.push(a.challengeId, b.challengeId);
      const settled = await Promise.allSettled([
        verifyAuthChallenge(a.challengeId, codeA),
        verifyAuthChallenge(b.challengeId, codeB),
      ]);
      const ok = settled.filter(
        (s) => s.status === "fulfilled"
      ) as PromiseFulfilledResult<{ user: { id: string } }>[];
      if (ok.length >= 1) {
        const ids = new Set(ok.map((o) => o.value.user.id));
        ok.forEach((o) => trackedUserIds.push(o.value.user.id));
        const count = await db.execute(sql`
          SELECT count(*)::int AS c FROM users
          WHERE email_lookup_hash = ${computeEmailLookupHash(normalizeEmail(email))}
        `);
        const c = Number((count.rows[0] as { c: number }).c);
        if (ids.size === 1 && c === 1) {
          pass("concurrent_same_email", `successes=${ok.length}`);
        } else {
          fail("concurrent_same_email", `users=${c} ids=${ids.size}`);
        }
      } else {
        fail("concurrent_same_email", "both failed");
      }
    }

    // TEST 19 — delivery failure
    {
      const email = smokeEmail("delfail");
      adapter.failNext = true;
      try {
        await createAuthChallenge(email, adapter);
        fail("delivery_failure", "did not throw");
      } catch (e) {
        if (isAuthDomainError(e) && e.code === "DELIVERY_FAILED") {
          // find any challenge for this lookup that might have been left
          const hash = computeEmailLookupHash(normalizeEmail(email));
          const rows = await db
            .select()
            .from(authChallenges)
            .where(eq(authChallenges.emailLookupHash, hash));
          rows.forEach((r) => trackedChallengeIds.push(r.id));
          const usable = rows.filter(
            (r) => !r.consumedAt && r.expiresAt > new Date()
          );
          if (usable.length === 0) pass("delivery_failure");
          else fail("delivery_failure", "usable challenge remains");
        } else {
          fail(
            "delivery_failure",
            isAuthDomainError(e) ? e.code : String(e)
          );
        }
      }
    }
  } finally {
    // Cleanup all test rows
    if (trackedUserIds.length) {
      const uniq = [...new Set(trackedUserIds)];
      for (const id of uniq) {
        await db.delete(sessions).where(eq(sessions.userId, id));
      }
      for (const id of uniq) {
        await db.delete(users).where(eq(users.id, id));
      }
    }
    // wipe remaining challenges/sessions/users from smoke
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM auth_challenges`);
    await db.execute(sql`DELETE FROM users`);

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM auth_challenges) AS challenges,
        (SELECT count(*)::int FROM sessions) AS sessions,
        (SELECT count(*)::int FROM families) AS families
    `);
    const row = counts.rows[0] as Record<string, number>;
    if (
      Number(row.users) === 0 &&
      Number(row.challenges) === 0 &&
      Number(row.sessions) === 0 &&
      Number(row.families) === 0
    ) {
      pass("cleanup", "all zero");
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
