import { NextRequest, NextResponse } from "next/server";
import { storeCode } from "@/lib/verifyCode";

/**
 * 邮箱验证码发送 API
 *
 * 使用 Resend 服务发送6位数字验证码到指定邮箱。
 *
 * POST /api/send-code
 * Body: { email: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    // 校验邮箱
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return NextResponse.json(
        { success: false, error: "请提供有效的邮箱地址" },
        { status: 400 }
      );
    }

    // 检查 Resend 是否已配置
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "📧 邮件服务尚未配置。请管理员在 .env.local 中设置 RESEND_API_KEY 以启用验证码发送功能。",
        },
        { status: 501 }
      );
    }

    // 生成6位随机数字验证码并存入内存
    const code = storeCode(email);

    // 使用 Resend 发送邮件
    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey);

    const { error: sendError } = await resend.emails.send({
      from: "云族谱 <onboarding@resend.dev>",
      to: email,
      subject: "📧 云族谱 - 邮箱验证码",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Georgia', serif; background: #f5f0e8; margin: 0; padding: 0; }
            .container { max-width: 480px; margin: 0 auto; padding: 32px 20px; }
            .card { background: #fff; border-radius: 16px; padding: 32px 24px;
                     box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                     border: 1px solid #d4a76a; }
            .title { font-size: 24px; color: #8b0000; text-align: center; margin-bottom: 8px; }
            .subtitle { font-size: 14px; color: #c4a67a; text-align: center; margin-bottom: 24px; }
            .code-box { background: #f9f6ef; border: 2px dashed #d4a76a; border-radius: 12px;
                         padding: 20px; margin: 24px 0; text-align: center; }
            .code { font-size: 36px; font-weight: bold; color: #8b0000;
                     letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .hint { font-size: 13px; color: #999; text-align: center; margin-top: 16px; }
            .footer { font-size: 12px; color: #c4a67a; text-align: center; margin-top: 24px;
                       line-height: 1.8; }
            .divider { border: none; border-top: 1px solid #f0e8d8; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="title">📧 邮箱验证</div>
              <div class="subtitle">云族谱 — 让家族记忆永存</div>
              <hr class="divider" />
              <p style="color:#5c3a2e; font-size:14px; line-height:1.8; text-align:center;">
                您的验证码为：
              </p>
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <p style="color:#8b0000; font-size:13px; text-align:center; font-weight:bold;">
                ⏰ 验证码5分钟内有效，请勿泄露给他人
              </p>
              <p style="font-size:12px; color:#c4a67a; text-align:center;">
                如非本人操作，请忽略此邮件。
              </p>
              <hr class="divider" />
              <div class="footer">
                云族谱 — 让家族记忆永存<br/>
                如有疑问请联系管理员
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (sendError) {
      console.error("=== Resend 发送失败 - 详细错误 ===");
      console.error("error:", JSON.stringify(sendError, null, 2));
      console.error("error.message:", (sendError as any)?.message);
      console.error("error.statusCode:", (sendError as any)?.statusCode);
      if (typeof sendError === "object" && sendError !== null) {
        for (const key of Object.keys(sendError as object)) {
          console.error(`sendError.${key}:`, (sendError as any)[key]);
        }
      }
      console.error("=====================================");
      return NextResponse.json(
        { success: false, error: "验证码发送失败，请稍后重试", detail: (sendError as any)?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "验证码已发送，请查收邮件",
    });
  } catch (err) {
    console.error("=== 发送验证码 API 错误 - 详细异常 ===");
    console.error("err:", JSON.stringify(err, null, 2));
    console.error("err.message:", err instanceof Error ? err.message : err);
    console.error("err.stack:", err instanceof Error ? err.stack : "N/A");
    if (err instanceof Error && "statusCode" in err) {
      console.error("err.statusCode:", (err as any).statusCode);
    }
    console.error("=======================================");
    return NextResponse.json(
      { success: false, error: "服务器内部错误", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

