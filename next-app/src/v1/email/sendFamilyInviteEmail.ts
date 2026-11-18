/**
 * Optional family-invite email via Resend.
 * Never log the invite URL or recipient in application logs.
 */

import {
  getV1AuthEmailFrom,
  isResendConfigured,
  isVerifiedSenderDomainReady,
} from "@/v1/email/config";

function isResendOfficialTestRecipient(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@resend.dev");
}

export type InviteEmailDelivery = "sent" | "skipped" | "failed";

export async function sendFamilyInviteEmail(input: {
  to: string;
  familyName: string;
  roleLabel: string;
  inviteUrl: string;
  expiresAt: Date;
}): Promise<InviteEmailDelivery> {
  const to = input.to.trim().toLowerCase();
  if (!to) return "skipped";
  if (!isResendConfigured()) return "skipped";
  if (!isVerifiedSenderDomainReady() && !isResendOfficialTestRecipient(to)) {
    return "skipped";
  }

  try {
    const apiKey = process.env.RESEND_API_KEY!.trim();
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const days = Math.max(
      1,
      Math.ceil((input.expiresAt.getTime() - Date.now()) / 86_400_000)
    );
    const result = await resend.emails.send({
      from: getV1AuthEmailFrom(),
      to,
      subject: `邀请你加入「${input.familyName}」族谱`,
      text: [
        `你好，`,
        ``,
        `有人邀请你以「${input.roleLabel}」身份加入云族谱家族档案「${input.familyName}」。`,
        ``,
        `打开下面的链接，登录后即可加入（链接仅可使用一次，约 ${days} 天内有效）：`,
        input.inviteUrl,
        ``,
        `如果不是你本人，请忽略此邮件。`,
      ].join("\n"),
    });
    if (result.error) return "failed";
    return "sent";
  } catch {
    return "failed";
  }
}
