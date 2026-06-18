import { NextRequest, NextResponse } from "next/server";

const PINATA_BASE = "https://api.pinata.cloud";

/**
 * POST /api/upload-photo
 * 上传照片到 Pinata IPFS，返回 CID
 * Body: FormData { file: File }
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    // 验证图片类型
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "仅支持图片文件" }, { status: 400 });
    }

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return NextResponse.json({ error: "缺少 PINATA_JWT 环境变量" }, { status: 500 });
    }

    // 构造 multipart form-data
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      "utf-8"
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

    const pinataRes = await fetch(`${PINATA_BASE}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pinataJwt}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    if (!pinataRes.ok) {
      const errText = await pinataRes.text();
      console.error("Pinata upload error:", errText);
      return NextResponse.json({ error: `Pinata 上传失败: ${pinataRes.statusText}` }, { status: 502 });
    }

    const json = await pinataRes.json();
    const cid = json.IpfsHash as string;

    return NextResponse.json({ cid, ipfsUrl: `https://gateway.pinata.cloud/ipfs/${cid}` });
  } catch (err) {
    console.error("upload-photo error:", err);
    return NextResponse.json({ error: "照片上传失败" }, { status: 500 });
  }
}