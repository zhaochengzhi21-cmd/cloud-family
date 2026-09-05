/**
 * V1 email / Resend config — never log secrets.
 */

const DEFAULT_FROM = "云族谱 <noreply@mianmianguadie.com>";

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Provider-neutral sender. Prefer V1_AUTH_EMAIL_FROM; else legacy verified sender.
 */
export function getV1AuthEmailFrom(): string {
  const configured = process.env.V1_AUTH_EMAIL_FROM?.trim();
  if (configured) return configured;
  return DEFAULT_FROM;
}

/**
 * True only when env explicitly claims real-recipient delivery is ready.
 * Never infer SUCCESS from Resend API alone.
 */
export function isVerifiedSenderDomainReady(): boolean {
  return process.env.V1_AUTH_SENDER_VERIFIED === "true";
}
