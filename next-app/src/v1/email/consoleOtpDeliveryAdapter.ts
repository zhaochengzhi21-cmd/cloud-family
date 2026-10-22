/**
 * Local / Preview OTP delivery — prints code to server console only.
 * Never include OTP in HTTP responses. Never use in Production launch.
 */

import type { OtpDeliveryAdapter, OtpDeliveryMeta } from "@/v1/domain/auth/delivery";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const tip = local.slice(0, Math.min(2, local.length));
  return `${tip}***@${domain}`;
}

export class ConsoleOtpDeliveryAdapter implements OtpDeliveryAdapter {
  async deliver(
    email: string,
    code: string,
    meta?: OtpDeliveryMeta
  ): Promise<void> {
    // Structured for local operators; challengeId only (no secrets beyond OTP itself).
    console.info(
      [
        "[V1 OTP console delivery]",
        `email=${maskEmail(email)}`,
        meta?.challengeId ? `challengeId=${meta.challengeId}` : null,
        `code=${code}`,
        "(local/preview only — do not enable for Production Alpha launch)",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

export function createConsoleOtpDeliveryAdapter(): ConsoleOtpDeliveryAdapter {
  return new ConsoleOtpDeliveryAdapter();
}

function isVercelProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Explicit opt-in: V1_OTP_DELIVERY=console.
 * Hard-disabled on Vercel Production even if mis-set.
 */
export function isConsoleOtpDeliveryEnabled(): boolean {
  if (isVercelProductionRuntime()) return false;
  return process.env.V1_OTP_DELIVERY?.trim().toLowerCase() === "console";
}
