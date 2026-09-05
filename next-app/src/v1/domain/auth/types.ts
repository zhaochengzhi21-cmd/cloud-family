/**
 * Future cookie policy for CF-V1-AUTH-002 (HTTP activation).
 * This foundation does not set cookies.
 */
export const V1_SESSION_COOKIE = {
  name: "cf_v1_session",
  httpOnly: true,
  /** Secure must be true in Production. */
  secureInProduction: true,
  sameSite: "Lax" as const,
  path: "/",
  /** ~30 days in seconds */
  maxAgeSeconds: 30 * 24 * 60 * 60,
};

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EMAIL_MAX_LENGTH = 254;
export const CURRENT_EMAIL_KEY_VERSION = 1;

/** AES-GCM envelope format version byte. */
export const EMAIL_CIPHER_FORMAT_V1 = 0x01;

/** Closed Alpha invite defaults. */
export const ALPHA_INVITE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ALPHA_INVITE_TOKEN_BYTES = 32;

/** OTP send throttling (DB-backed via auth_challenges). */
export const OTP_MIN_INTERVAL_MS = 60 * 1000;
export const OTP_ROLLING_15M_LIMIT = 3;
export const OTP_ROLLING_15M_MS = 15 * 60 * 1000;
export const OTP_ROLLING_24H_LIMIT = 10;
export const OTP_ROLLING_24H_MS = 24 * 60 * 60 * 1000;

export const V1_SESSION_COOKIE_NAME = "cf_v1_session";
