/**
 * Closed Alpha invite operator service — no public HTTP API.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { getV1Db, type V1Db } from "@/db/client";
import { AuthDomainError } from "@/v1/domain/auth/errors";
import { normalizeEmail } from "@/v1/domain/auth/email";
import { computeEmailLookupHash } from "@/v1/domain/auth/crypto";
import {
  ALPHA_INVITE_DEFAULT_TTL_MS,
  ALPHA_INVITE_TOKEN_BYTES,
} from "@/v1/domain/auth/types";
import * as inviteRepo from "@/v1/repositories/alphaInviteRepository";

function dbOrDefault(db?: V1Db): V1Db {
  return db ?? getV1Db();
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export type CreateAlphaInviteResult = {
  inviteId: string;
  /** Raw token — show once; never log or persist. */
  rawToken: string;
  expiresAt: Date;
};

/**
 * Create email-bound alpha invite. Caller must not log rawToken or email.
 */
export async function createAlphaInvite(
  email: string,
  options?: {
    db?: V1Db;
    ttlMs?: number;
    now?: Date;
  }
): Promise<CreateAlphaInviteResult> {
  const canonical = normalizeEmail(email);
  const lookupHash = computeEmailLookupHash(canonical);
  const now = options?.now ?? new Date();
  const ttl = options?.ttlMs ?? ALPHA_INVITE_DEFAULT_TTL_MS;
  if (ttl <= 0 || ttl > ALPHA_INVITE_DEFAULT_TTL_MS * 4) {
    throw new AuthDomainError("AUTH_CONFIGURATION_ERROR", "invalid invite ttl");
  }
  const expiresAt = new Date(now.getTime() + ttl);
  const rawToken = randomBytes(ALPHA_INVITE_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashInviteToken(rawToken);
  const inviteId = randomUUID();

  await inviteRepo.insertAlphaInvite(dbOrDefault(options?.db), {
    id: inviteId,
    tokenHash,
    emailLookupHash: lookupHash,
    expiresAt,
    createdAt: now,
  });

  return { inviteId, rawToken, expiresAt };
}

export async function revokeAlphaInvite(
  inviteId: string,
  options?: { db?: V1Db; now?: Date }
): Promise<boolean> {
  return inviteRepo.revokeInvite(
    dbOrDefault(options?.db),
    inviteId,
    options?.now ?? new Date()
  );
}

/**
 * Resolve a raw invite for request-code gating.
 * Returns invite id only when valid and email-bound match.
 */
export async function resolveValidInviteForEmail(
  rawInviteToken: string | undefined | null,
  emailLookupHash: string,
  options?: { db?: V1Db; now?: Date }
): Promise<{ inviteId: string } | null> {
  if (!rawInviteToken || typeof rawInviteToken !== "string") return null;
  if (!rawInviteToken.trim()) return null;

  const now = options?.now ?? new Date();
  const tokenHash = hashInviteToken(rawInviteToken.trim());
  const row = await inviteRepo.findInviteByTokenHash(
    dbOrDefault(options?.db),
    tokenHash
  );
  if (!row) return null;
  if (!inviteRepo.isInviteCurrentlyValid(row, now)) return null;
  if (row.emailLookupHash !== emailLookupHash) return null;
  return { inviteId: row.id };
}
