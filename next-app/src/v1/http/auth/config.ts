/**
 * V1 Auth HTTP feature gate + origin policy — fail closed in Production.
 */

export function isV1AlphaAuthEnabled(): boolean {
  return process.env.V1_ALPHA_AUTH_ENABLED === "true";
}

export function getAllowedOrigins(): string[] {
  const raw = process.env.V1_ALLOWED_ORIGINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Safe defaults for local + production
  const defaults = ["https://cloud-family.vercel.app"];
  if (process.env.NODE_ENV !== "production") {
    defaults.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return defaults;
}

/**
 * Same-origin check for mutation endpoints.
 * Missing Origin on browser POST → DENY (fail closed).
 * Non-browser tools may set Origin explicitly for tests.
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin);
}

export function noStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
  };
}
