/**
 * Server-only JWT secret accessor.
 *
 * Call this at sign/verify time (not at module import) so missing
 * JWT_SECRET fails authentication paths explicitly instead of
 * silently using a public default key.
 */

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error(
      "JWT_SECRET 未配置。请在环境变量中设置 JWT_SECRET 后再启用认证功能。"
    );
  }
  return secret;
}
