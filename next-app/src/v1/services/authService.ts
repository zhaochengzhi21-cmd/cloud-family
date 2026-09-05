import { randomBytes, randomInt, randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { AuthDomainError } from "@/v1/domain/auth/errors";
import { normalizeEmail } from "@/v1/domain/auth/email";
import {
  computeEmailLookupHash,
  encryptEmail,
  decryptEmail,
  computeOtpDigest,
  timingSafeEqualDigest,
  hashSessionToken,
} from "@/v1/domain/auth/crypto";
import type { OtpDeliveryAdapter } from "@/v1/domain/auth/delivery";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SESSION_TTL_MS,
  OTP_MIN_INTERVAL_MS,
  OTP_ROLLING_15M_LIMIT,
  OTP_ROLLING_15M_MS,
  OTP_ROLLING_24H_LIMIT,
  OTP_ROLLING_24H_MS,
} from "@/v1/domain/auth/types";
import * as repo from "@/v1/repositories/authRepository";
import * as inviteRepo from "@/v1/repositories/alphaInviteRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

function generateOtpCode(): string {
  const n = randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, "0");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export type AuthUserView = {
  id: string;
  emailVerifiedAt: Date | null;
};

export type CreateChallengeResult = {
  challengeId: string;
  expiresAt: Date;
};

/**
 * DB-backed OTP throttle. Returns true when a new real send is allowed.
 */
export async function isOtpSendAllowed(
  emailLookupHash: string,
  options?: { db?: V1Db; now?: Date }
): Promise<boolean> {
  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  const latest = await repo.findLatestChallengeCreatedAt(
    database,
    emailLookupHash
  );
  if (latest && now.getTime() - latest.getTime() < OTP_MIN_INTERVAL_MS) {
    return false;
  }

  const in15 = await repo.countChallengesSince(
    database,
    emailLookupHash,
    new Date(now.getTime() - OTP_ROLLING_15M_MS)
  );
  if (in15 >= OTP_ROLLING_15M_LIMIT) return false;

  const in24 = await repo.countChallengesSince(
    database,
    emailLookupHash,
    new Date(now.getTime() - OTP_ROLLING_24H_MS)
  );
  if (in24 >= OTP_ROLLING_24H_LIMIT) return false;

  return true;
}

/**
 * Create OTP challenge + deliver via adapter.
 * On delivery failure the challenge is invalidated and cannot be used.
 */
export async function createAuthChallenge(
  email: string,
  deliveryAdapter: OtpDeliveryAdapter,
  options?: {
    db?: V1Db;
    alphaInviteId?: string | null;
    now?: Date;
  }
): Promise<CreateChallengeResult> {
  const canonical = normalizeEmail(email);
  const lookupHash = computeEmailLookupHash(canonical);
  const { ciphertext, keyVersion } = encryptEmail(canonical);
  const challengeId = randomUUID();
  const code = generateOtpCode();
  const codeDigest = computeOtpDigest(challengeId, code);
  const now = options?.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  const database = dbOrDefault(options?.db);

  await repo.insertChallenge(database, {
    id: challengeId,
    emailLookupHash: lookupHash,
    emailCiphertext: ciphertext,
    emailKeyVersion: keyVersion,
    codeDigest,
    expiresAt,
    createdAt: now,
    alphaInviteId: options?.alphaInviteId ?? null,
  });

  try {
    await deliveryAdapter.deliver(canonical, code, { challengeId });
  } catch {
    await repo.invalidateChallenge(database, challengeId, new Date());
    throw new AuthDomainError("DELIVERY_FAILED");
  }

  return { challengeId, expiresAt };
}

export type VerifyChallengeResult = {
  user: AuthUserView;
  sessionToken: string;
  sessionExpiresAt: Date;
};

/**
 * Verify OTP inside a transaction with row lock.
 * New-user path consumes alpha invite atomically with user creation.
 * Returns raw session token once — never stored in DB.
 */
export async function verifyAuthChallenge(
  challengeId: string,
  code: string,
  options?: { db?: V1Db; now?: Date }
): Promise<VerifyChallengeResult> {
  if (!/^\d{6}$/.test(code)) {
    throw new AuthDomainError("INVALID_CODE");
  }

  const database = dbOrDefault(options?.db);
  const now = options?.now ?? new Date();

  type Outcome =
    | { kind: "ok"; result: VerifyChallengeResult }
    | { kind: "invalid"; attempts: number }
    | { kind: "error"; code: AuthDomainError["code"] };

  const outcome: Outcome = await database.transaction(async (tx) => {
    const challenge = await repo.lockChallengeById(tx, challengeId);
    if (!challenge) {
      return { kind: "error", code: "CHALLENGE_NOT_FOUND" };
    }
    if (challenge.consumedAt) {
      return { kind: "error", code: "CHALLENGE_CONSUMED" };
    }
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      return { kind: "error", code: "CHALLENGE_EXPIRED" };
    }
    if (challenge.failedAttempts >= OTP_MAX_ATTEMPTS) {
      return { kind: "error", code: "CHALLENGE_LOCKED" };
    }

    const submitted = computeOtpDigest(challengeId, code);
    if (!timingSafeEqualDigest(submitted, challenge.codeDigest)) {
      await repo.incrementChallengeAttempts(tx, challengeId);
      return {
        kind: "invalid",
        attempts: challenge.failedAttempts + 1,
      };
    }

    await repo.markChallengeConsumed(tx, challengeId, now);

    let email: string;
    try {
      email = decryptEmail(
        challenge.emailCiphertext,
        challenge.emailKeyVersion
      );
    } catch {
      return { kind: "error", code: "AUTH_CONFIGURATION_ERROR" };
    }

    const { ciphertext, keyVersion } = encryptEmail(email);

    // Closed Alpha registration challenges must consume invite exactly once.
    // Concurrent verifies: loser fails even if the winner already inserted the User.
    if (challenge.alphaInviteId) {
      const consumed = await inviteRepo.tryConsumeInvite(
        tx,
        challenge.alphaInviteId,
        now
      );
      if (!consumed) {
        return { kind: "error", code: "INVITE_CONSUMED" };
      }
    }

    let user = await repo.findUserByLookupHash(tx, challenge.emailLookupHash);

    if (!user) {
      if (!challenge.alphaInviteId) {
        return { kind: "error", code: "INVITE_INVALID" };
      }

      const userId = randomUUID();
      try {
        await repo.insertUser(tx, {
          id: userId,
          emailLookupHash: challenge.emailLookupHash,
          emailCiphertext: ciphertext,
          emailKeyVersion: keyVersion,
          emailVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        user = await repo.findUserByLookupHash(tx, challenge.emailLookupHash);
      } catch {
        user = await repo.findUserByLookupHash(tx, challenge.emailLookupHash);
        if (!user) {
          return { kind: "error", code: "AUTH_CONFIGURATION_ERROR" };
        }
        await repo.updateUserEmailCrypto(tx, user.id, {
          emailCiphertext: ciphertext,
          emailKeyVersion: keyVersion,
          emailVerifiedAt: now,
          updatedAt: now,
        });
      }
    } else {
      if (user.deletedAt) {
        return { kind: "error", code: "SESSION_NOT_FOUND" };
      }
      await repo.updateUserEmailCrypto(tx, user.id, {
        emailCiphertext: ciphertext,
        emailKeyVersion: keyVersion,
        emailVerifiedAt: now,
        updatedAt: now,
      });
    }

    if (!user) {
      return { kind: "error", code: "AUTH_CONFIGURATION_ERROR" };
    }

    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await repo.insertSession(tx, {
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: sessionExpiresAt,
      createdAt: now,
    });

    return {
      kind: "ok",
      result: {
        user: { id: user.id, emailVerifiedAt: now },
        sessionToken: rawToken,
        sessionExpiresAt,
      },
    };
  });

  if (outcome.kind === "error") {
    throw new AuthDomainError(outcome.code);
  }
  if (outcome.kind === "invalid") {
    if (outcome.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AuthDomainError("CHALLENGE_LOCKED");
    }
    throw new AuthDomainError("INVALID_CODE");
  }
  return outcome.result;
}

export async function createSession(
  userId: string,
  options?: { db?: V1Db }
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const database = dbOrDefault(options?.db);
  const user = await repo.findUserById(database, userId);
  if (!user || user.deletedAt) {
    throw new AuthDomainError("SESSION_NOT_FOUND");
  }
  const now = new Date();
  const rawToken = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await repo.insertSession(database, {
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
    createdAt: now,
  });
  return { sessionToken: rawToken, expiresAt };
}

export async function resolveSession(
  rawToken: string,
  options?: { db?: V1Db }
): Promise<AuthUserView> {
  if (!rawToken || typeof rawToken !== "string") {
    throw new AuthDomainError("SESSION_NOT_FOUND");
  }
  const database = dbOrDefault(options?.db);
  const tokenHash = hashSessionToken(rawToken);
  const session = await repo.findSessionByTokenHash(database, tokenHash);
  if (!session) {
    throw new AuthDomainError("SESSION_NOT_FOUND");
  }
  if (session.revokedAt) {
    throw new AuthDomainError("SESSION_REVOKED");
  }
  const now = new Date();
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new AuthDomainError("SESSION_EXPIRED");
  }
  const user = await repo.findUserById(database, session.userId);
  if (!user || user.deletedAt) {
    throw new AuthDomainError("SESSION_NOT_FOUND");
  }
  await repo.touchSession(database, session.id, now);
  return {
    id: user.id,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

export async function revokeSession(
  rawToken: string,
  options?: { db?: V1Db }
): Promise<void> {
  const database = dbOrDefault(options?.db);
  const tokenHash = hashSessionToken(rawToken);
  await repo.revokeSessionByTokenHash(database, tokenHash, new Date());
}

export async function revokeAllUserSessions(
  userId: string,
  options?: { db?: V1Db }
): Promise<void> {
  await repo.revokeAllUserSessions(
    dbOrDefault(options?.db),
    userId,
    new Date()
  );
}

/** Test helper: insert already-expired challenge. */
export async function insertExpiredChallengeForTest(
  email: string,
  code: string,
  options?: { db?: V1Db }
): Promise<string> {
  const canonical = normalizeEmail(email);
  const lookupHash = computeEmailLookupHash(canonical);
  const { ciphertext, keyVersion } = encryptEmail(canonical);
  const challengeId = randomUUID();
  const codeDigest = computeOtpDigest(challengeId, code);
  const past = new Date(Date.now() - 60_000);
  await repo.insertChallenge(dbOrDefault(options?.db), {
    id: challengeId,
    emailLookupHash: lookupHash,
    emailCiphertext: ciphertext,
    emailKeyVersion: keyVersion,
    codeDigest,
    expiresAt: past,
    createdAt: past,
  });
  return challengeId;
}

/** Test helper: insert already-expired session for a user. */
export async function insertExpiredSessionForTest(
  userId: string,
  options?: { db?: V1Db }
): Promise<string> {
  const rawToken = generateSessionToken();
  const past = new Date(Date.now() - 60_000);
  await repo.insertSession(dbOrDefault(options?.db), {
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(rawToken),
    expiresAt: past,
    createdAt: past,
  });
  return rawToken;
}
