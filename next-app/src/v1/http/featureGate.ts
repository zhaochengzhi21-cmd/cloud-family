/**
 * V1 Closed Alpha App / Auth feature gates — fail closed.
 */

export function isV1AlphaAuthEnabled(): boolean {
  return process.env.V1_ALPHA_AUTH_ENABLED === "true";
}

export function isV1AlphaAppEnabled(): boolean {
  return process.env.V1_ALPHA_APP_ENABLED === "true";
}
