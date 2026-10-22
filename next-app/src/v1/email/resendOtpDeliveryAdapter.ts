/**
 * Resend OTP delivery — provider-specific; keep out of Auth Domain core.
 */

import type { OtpDeliveryAdapter, OtpDeliveryMeta } from "@/v1/domain/auth/delivery";
import {
  getV1AuthEmailFrom,
  isResendConfigured,
  isVerifiedSenderDomainReady,
} from "@/v1/email/config";

/** Resend accepts these without a verified production sender domain. */
function isResendOfficialTestRecipient(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@resend.dev");
}

export class ResendOtpDeliveryAdapter implements OtpDeliveryAdapter {
  async deliver(
    email: string,
    code: string,
    meta?: OtpDeliveryMeta
  ): Promise<void> {
    if (!isResendConfigured()) {
      throw new Error("RESEND_NOT_CONFIGURED");
    }
    // Fail-closed for human recipients until ops explicitly opts in.
    if (
      !isVerifiedSenderDomainReady() &&
      !isResendOfficialTestRecipient(email)
    ) {
      throw new Error("SENDER_DOMAIN_REQUIRED");
    }
    const apiKey = process.env.RESEND_API_KEY!.trim();
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    const payload: {
      from: string;
      to: string;
      subject: string;
      text: string;
      headers?: Record<string, string>;
    } = {
      from: getV1AuthEmailFrom(),
      to: email,
      subject: "云族谱登录验证码",
      text: [
        `您的验证码是：${code}`,
        "",
        "验证码 10 分钟内有效。",
        "如果不是您本人操作，请忽略此邮件。",
      ].join("\n"),
    };

    // Idempotency via challengeId when supported by SDK
    const sendOpts: { idempotencyKey?: string } = {};
    if (meta?.challengeId) {
      sendOpts.idempotencyKey = meta.challengeId;
    }

    const result = await resend.emails.send(payload, sendOpts);
    if (result.error) {
      throw new Error("RESEND_SEND_FAILED");
    }
  }
}

export function createResendOtpDeliveryAdapter(): ResendOtpDeliveryAdapter {
  return new ResendOtpDeliveryAdapter();
}
