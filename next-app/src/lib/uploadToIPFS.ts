/**
 * IPFS 上传工具 — 使用 Pinata (https://app.pinata.cloud)
 * 环境变量: PINATA_JWT
 *
 * 上传文件或 JSON 数据到 Pinata IPFS，返回 CID
 */

const PINATA_BASE = "https://api.pinata.cloud";

// ---------- 内部：通过 Pinata API 上传 Buffer ----------
async function pinataUpload(
  data: Buffer,
  filename: string,
  contentType: string,
  pinataJwt: string
): Promise<string> {
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const bodyParts: string[] = [];

  // 文件字段
  bodyParts.push(
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
  );

  // 把 Buffer 转成 base64，和前面文本拼起来再用 Buffer.concat
  const header = Buffer.from(bodyParts.join("\r\n") + "\r\n", "utf-8");
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");

  const bodyBuffer = Buffer.concat([header, data, footer]);

  const res = await fetch(`${PINATA_BASE}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pinataJwt}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  return json.IpfsHash as string;
}

// ---------- 上传多个文件 → 返回目录 CID ----------
export async function uploadFilesToIPFS(
  files: globalThis.File[],
  token: string
): Promise<string> {
  const cids: string[] = [];

  for (const f of files) {
    const arrayBuffer = await f.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const cid = await pinataUpload(buf, f.name, f.type || "application/octet-stream", token);
    cids.push(cid);
  }

  // 如果有多个文件，将文件名 → CID 映射也上传一份作为目录索引
  if (cids.length === 1) {
    return cids[0];
  }

  // 多个文件：创建一个清单 JSON 上传，将其 CID 作为目录 CID
  const manifest: Record<string, string> = {};
  files.forEach((f, i) => {
    manifest[f.name] = cids[i];
  });
  const manifestStr = JSON.stringify(manifest, null, 2);
  const manifestCid = await pinataUpload(
    Buffer.from(manifestStr, "utf-8"),
    "manifest.json",
    "application/json",
    token
  );

  return manifestCid;
}

// ---------- 上传 JSON 对象 → 返回 CID ----------
export async function uploadJSONToIPFS(
  data: Record<string, unknown>,
  token: string
): Promise<string> {
  const jsonStr = JSON.stringify(data);
  const buf = Buffer.from(jsonStr, "utf-8");

  const cid = await pinataUpload(buf, "metadata.json", "application/json", token);
  return cid;
}