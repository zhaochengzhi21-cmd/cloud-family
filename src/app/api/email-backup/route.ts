import { NextRequest, NextResponse } from "next/server";

/**
 * 邮箱备份 API
 *
 * 接收邮箱地址、家族名和链接，发送备份邮件。
 * 优先使用 Nodemailer + SMTP，如果未配置则返回友好提示。
 *
 * POST /api/email-backup
 * Body: { email: string, familyId?: string, familyName?: string, url: string }
 */

export async function POST(request: NextRequest) {
  try {
    const { email, familyName, url } = await request.json();

    // 校验必要参数
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return NextResponse.json(
        { success: false, error: "请提供有效的邮箱地址" },
        { status: 400 }
      );
    }

    if (!url) {
      return NextResponse.json(
        { success: false, error: "缺少家族链接" },
        { status: 400 }
      );
    }

    const displayName = familyName || "我的家族谱";

    // 尝试使用 Nodemailer SMTP 发送（如果已配置）
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const fromEmail = process.env.SMTP_FROM || smtpUser || "noreply@yunzupu.app";

    if (smtpHost && smtpUser && smtpPass) {
      try {
        // 动态 import Nodemailer（仅在需要时加载）
        const nodemailer = await import("nodemailer");

        const transporter = nodemailer.default.createTransport({
          host: smtpHost,
          port: parseInt(smtpPort || "587", 10),
          secure: smtpPort === "465",
          auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
          from: `"云族谱" <${fromEmail}>`,
          to: email,
          subject: `📜 族谱备份 — ${displayName}`,
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
                .family-name { font-size: 20px; color: #5c3a2e; text-align: center;
                               font-weight: bold; margin: 16px 0; }
                .btn { display: block; width: 100%; padding: 14px 0; margin: 24px 0;
                        background: #8b0000; color: #fff !important; text-align: center;
                        border-radius: 12px; font-size: 16px; font-weight: bold;
                        text-decoration: none; letter-spacing: 1px; }
                .btn:hover { background: #a52a2a; }
                .footer { font-size: 12px; color: #c4a67a; text-align: center; margin-top: 24px;
                          line-height: 1.8; }
                .divider { border: none; border-top: 1px solid #f0e8d8; margin: 20px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="card">
                  <div class="title">📜 云族谱备份</div>
                  <div class="subtitle">您的家族谱已安全保存至区块链</div>
                  <hr class="divider" />
                  <div class="family-name">${displayName}</div>
                  <p style="color:#5c3a2e; font-size:14px; line-height:1.8; text-align:center;">
                    您可以通过以下永久链接随时查看和编辑本谱：<br/>
                    <span style="font-size:12px; color:#8b0000; word-break:break-all;">${url}</span>
                  </p>
                  <a href="${url}" class="btn" target="_blank" rel="noopener noreferrer">
                    📂 打开族谱
                  </a>
                  <p style="font-size:12px; color:#c4a67a; text-align:center;">
                    此链接基于区块链和 IPFS 技术，数据永久保存、不可篡改。
                  </p>
                  <hr class="divider" />
                  <div class="footer">
                    云族谱 — 让家族记忆永存<br/>
                    如非本人操作，请忽略此邮件。
                  </div>
                </div>
              </div>
            </body>
            </html>
          `,
        });

        return NextResponse.json({ success: true });
      } catch (smtpError) {
        console.error("SMTP 发送失败:", smtpError);
        return NextResponse.json(
          { success: false, error: "邮件服务暂时不可用，请稍后重试" },
          { status: 500 }
        );
      }
    }

    // 未配置 SMTP → 返回友好提示
    return NextResponse.json(
      {
        success: false,
        error:
          "📧 邮件服务尚未配置。请管理员在 .env.local 中设置 SMTP_HOST、SMTP_USER、SMTP_PASS 等环境变量以启用邮件发送功能。",
      },
      { status: 501 }
    );
  } catch (err) {
    console.error("邮箱备份 API 错误:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}