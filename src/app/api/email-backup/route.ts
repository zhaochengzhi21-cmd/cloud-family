import { NextRequest, NextResponse } from "next/server";

/**
 * 邮箱备份 API
 *
 * 使用 Resend API 发送备份邮件。
 * 需要设置环境变量 RESEND_API_KEY。
 *
 * POST /api/email-backup
 * Body: { email: string, familyId?: string, familyName?: string, url: string }
 */

const RESEND_API_URL = "https://api.resend.com/emails";

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

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "📧 邮件服务尚未配置。请管理员在环境变量中设置 RESEND_API_KEY 以启用邮件发送功能。",
        },
        { status: 501 }
      );
    }

    const displayName = familyName || "我的家族谱";

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "云族谱 <noreply@mianmianguadie.com>",
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
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend API 错误:", data);
      return NextResponse.json(
        { success: false, error: "邮件服务暂时不可用，请稍后重试" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("邮箱备份 API 错误:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}