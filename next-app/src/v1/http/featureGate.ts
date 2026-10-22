/**
 * V1 Closed Alpha feature gates — fail closed.
 */

export function isV1AlphaAuthEnabled(): boolean {
  return process.env.V1_ALPHA_AUTH_ENABLED === "true";
}

export function isV1AlphaAppEnabled(): boolean {
  return process.env.V1_ALPHA_APP_ENABLED === "true";
}

export function isV1AlphaUiEnabled(): boolean {
  return process.env.V1_ALPHA_UI_ENABLED === "true";
}

/**
 * Local/Preview only: allow session-authenticated finalize when Vercel
 * cannot callback localhost. Hard-disabled on Vercel Production.
 */
export function isV1BlobLocalFinalizeEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.V1_BLOB_LOCAL_FINALIZE === "true";
}
