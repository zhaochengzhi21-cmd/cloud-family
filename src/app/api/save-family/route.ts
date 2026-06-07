import { NextRequest, NextResponse } from "next/server";
import { Interface } from "@ethersproject/abi";
import { keccak256 } from "@ethersproject/keccak256";
import { hexlify, zeroPad, hexValue } from "@ethersproject/bytes";
import { Wallet } from "@ethersproject/wallet";
import { uploadFilesToIPFS, uploadJSONToIPFS } from "@/lib/uploadToIPFS";
import type { FamilyTree } from "@/types/family";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

/** JWT 密钥 */
const JWT_SECRET = process.env.JWT_SECRET || "yunzupu-jwt-secret-default-key";

/** 家族关联数据文件路径 */
const DATA_DIR = path.join(process.cwd(), "data");
const FAMILIES_FILE = path.join(DATA_DIR, "families.json");
const FAMILIES_META_FILE = path.join(DATA_DIR, "families-meta.json");

/**
 * 写入家族创建者元数据（保存到 families-meta.json，记录创建者和编辑者列表）
 */
function writeCreatorMeta(emailHash: string, familyId: string, familyName: string, searchable: boolean = false) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    let metaList: Array<{
      familyId: string;
      familyName: string;
      creatorEmailHash: string;
      editors: string[];
      createdAt: string;
      searchable: boolean;
    }> = [];
    if (fs.existsSync(FAMILIES_META_FILE)) {
      try {
        metaList = JSON.parse(fs.readFileSync(FAMILIES_META_FILE, "utf-8"));
      } catch {
        metaList = [];
      }
    }
    // 避免重复记录
    const existing = metaList.findIndex((m) => m.familyId === familyId);
    if (existing === -1) {
      metaList.push({
        familyId,
        familyName,
        creatorEmailHash: emailHash,
        editors: [],
        createdAt: new Date().toISOString(),
        searchable,
      });
    } else {
      // 更新 searchable 字段
      metaList[existing].searchable = searchable;
    }
    fs.writeFileSync(FAMILIES_META_FILE, JSON.stringify(metaList, null, 2), "utf-8");
  } catch (err) {
    console.error("writeCreatorMeta error:", err);
  }
}

/**
 * 更新家族元数据中的 memberCount 字段
 */
function updateFamilyMetaMemberCount(familyId: string, memberCount: number) {
  try {
    if (!fs.existsSync(FAMILIES_META_FILE)) return;
    const raw = fs.readFileSync(FAMILIES_META_FILE, "utf-8");
    const metaList = JSON.parse(raw);
    if (Array.isArray(metaList)) {
      const existing = metaList.findIndex((m: Record<string, unknown>) => m.familyId === familyId);
      if (existing !== -1) {
        metaList[existing].memberCount = memberCount;
        fs.writeFileSync(FAMILIES_META_FILE, JSON.stringify(metaList, null, 2), "utf-8");
      }
    }
  } catch (err) {
    console.error("updateFamilyMetaMemberCount error:", err);
  }
}

/**
 * 写入家族关联记录（将家族与创建者邮箱绑定）
 */
function writeFamilyBinding(emailHash: string, familyId: string, familyName: string) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    let records: Array<{ emailHash: string; familyId: string; familyName: string; createdAt: string }> = [];
    if (fs.existsSync(FAMILIES_FILE)) {
      try {
        records = JSON.parse(fs.readFileSync(FAMILIES_FILE, "utf-8"));
      } catch {
        records = [];
      }
    }
    records.push({
      emailHash,
      familyId,
      familyName,
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(FAMILIES_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (err) {
    console.error("writeFamilyBinding error:", err);
  }
}

/**
 * 从请求中获取 JWT token 并解析 emailHash
 */
function getEmailHashFromRequest(request: NextRequest): string | null {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET) as { emailHash: string };
    return decoded.emailHash;
  } catch {
    return null;
  }
}

const W3S_TOKEN = process.env.PINATA_JWT || "";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const CONTRACT_PRIVATE_KEY = process.env.CONTRACT_PRIVATE_KEY || "";
const ALCHEMY_POLYGON_RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || "";

// ---------- 合约方法与 ABI ----------
const CONTRACT_ABI = [
  "function saveFamilyData(bytes32 familyId, string calldata dataHash) external",
  "function familyDataHash(bytes32) external view returns (string)",
];

// 延迟初始化 Interface（避免模块加载时触发 ethers 副作用）
function getContractInterface(): Interface {
  return new Interface(CONTRACT_ABI);
}

// ---------- 自定义错误类 ----------
class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

class TransactionFailedError extends Error {
  txHash: string;
  constructor(txHash: string, message: string) {
    super(message);
    this.name = "TransactionFailedError";
    this.txHash = txHash;
  }
}

// ---------- 用原生 fetch 调用 RPC ----------
async function rpcCall(
  method: string,
  params: unknown[]
): Promise<unknown> {
  console.log(`[rpcCall] method=${method}, params=`, JSON.stringify(params));
  const res = await fetch(ALCHEMY_POLYGON_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC call ${method} failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.error) {
    console.log(`[rpcCall] RPC error for ${method}:`, json.error);
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }

  return json.result;
}

/** 获取当前 nonce */
async function getNonce(address: string): Promise<number> {
  console.log(`[getNonce] address=${address}`);
  const hex = await rpcCall("eth_getTransactionCount", [address, "pending"]) as string;
  const nonce = parseInt(hex, 16);
  console.log(`[getNonce] nonce=${nonce}`);
  return nonce;
}

/** 获取当前 gas 价格 */
async function getGasPrice(): Promise<bigint> {
  console.log("[getGasPrice]");
  const hex = await rpcCall("eth_gasPrice", []) as string;
  const price = BigInt(hex);
  console.log(`[getGasPrice] price=${price}`);
  return price;
}

/** 估算 gas limit */
async function estimateGas(
  from: string,
  to: string,
  data: string,
  value = "0x0"
): Promise<bigint> {
  console.log(`[estimateGas] from=${from}, to=${to}, data.length=${data.length}`);
  const hex = await rpcCall("eth_estimateGas", [{
    from,
    to,
    data,
    value,
  }]) as string;
  const gas = BigInt(hex);
  console.log(`[estimateGas] gas=${gas}`);
  return gas;
}

/** 获取 chainId */
async function getChainId(): Promise<number> {
  console.log("[getChainId]");
  const hex = await rpcCall("eth_chainId", []) as string;
  const chainId = parseInt(hex, 16);
  console.log(`[getChainId] chainId=${chainId}`);
  return chainId;
}

/**
 * 使用 eth_call 模拟执行交易，检查是否会 revert
 * 如果成功返回 true；如果失败会抛出 SimulationError
 */
async function simulateCall(
  from: string,
  to: string,
  data: string
): Promise<void> {
  console.log(`[simulateCall] from=${from}, to=${to}, data.length=${data.length}`);
  try {
    // eth_call 不消耗 gas，只需传 from/to/data
    const result = await rpcCall("eth_call", [{
      from,
      to,
      data,
    }, "latest"]) as string;
    console.log(`[simulateCall] success, result=${result}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[simulateCall] FAILED (expected revert): ${msg}`);
    // 尝试从 RPC 错误中提取 revert reason
    // 常见格式: "execution reverted: <reason>" 或包含 data 字段
    throw new SimulationError(msg);
  }
}

/** 发送已签名的交易 */
async function sendRawTransaction(signedTx: string): Promise<string> {
  console.log("[sendRawTransaction] sending signed transaction...");
  const txHash = await rpcCall("eth_sendRawTransaction", [signedTx]) as string;
  console.log(`[sendRawTransaction] txHash=${txHash}`);
  return txHash;
}

/** 等待交易收据 */
async function waitForTransaction(txHash: string, maxRetries = 30): Promise<{ status: number; transactionHash: string }> {
  console.log(`[waitForTransaction] txHash=${txHash}, maxRetries=${maxRetries}`);
  for (let i = 0; i < maxRetries; i++) {
    console.log(`[waitForTransaction] polling attempt ${i + 1}/${maxRetries}`);
    const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]) as Record<string, unknown> | null;
    if (receipt) {
      const status = parseInt(receipt.status as string, 16);
      console.log(`[waitForTransaction] receipt found, status=${status}, txHash=${receipt.transactionHash as string}`);
      return {
        status,
        transactionHash: receipt.transactionHash as string,
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction not confirmed within timeout");
}

/**
 * 将序列化的数据上传到 IPFS 并返回 CID
 */
async function uploadMetadata(
  metadata: Record<string, unknown>,
  token: string
): Promise<string> {
  return uploadJSONToIPFS(metadata, token);
}

/**
 * 连接合约并调用 saveFamilyData——使用原生 RPC 调用，绕过 ethers Provider 的 detectNetwork 问题
 */
async function onChainSave(
  cid: string
): Promise<{ txHash: string; familyIdBytes32: string }> {
  // 用 keccak256 生成确定性 familyId (与 ethers.utils.id 等价，都是 keccak256)
  console.log("[onChainSave] generating familyId...");
  const familyId = keccak256(Buffer.from(cid + Date.now()));
  const familyIdBytes32 = hexlify(zeroPad(familyId, 32));
  console.log(`[onChainSave] familyIdBytes32=${familyIdBytes32}`);

  // 1) 构造 calldata
  console.log("[onChainSave] encoding function data...");
  const iface = getContractInterface();
  const data = iface.encodeFunctionData("saveFamilyData", [
    familyIdBytes32,
    cid,
  ]);
  console.log(`[onChainSave] encoded data length=${data.length}`);

  // 2) 钱包
  console.log("[onChainSave] initializing wallet...");
  const wallet = new Wallet(CONTRACT_PRIVATE_KEY);
  const from = wallet.address;
  console.log(`[onChainSave] from=${from}`);

  // 3) 获取链上参数
  console.log("[onChainSave] fetching on-chain parameters...");
  const [nonce, gasPriceRaw, gasLimit, chainId] = await Promise.all([
    getNonce(from),
    getGasPrice(),
    estimateGas(from, CONTRACT_ADDRESS, data),
    getChainId(),
  ]);
  console.log(`[onChainSave] nonce=${nonce}, gasPrice=${gasPriceRaw}, gasLimit=${gasLimit}, chainId=${chainId}`);

  // === 4) eth_call 模拟执行，提前检测 revert ===
  console.log("[onChainSave] simulating via eth_call...");
  await simulateCall(from, CONTRACT_ADDRESS, data);
  console.log("[onChainSave] simulation passed, proceeding to send transaction...");

  // 5) 构造并签名交易
  console.log("[onChainSave] constructing and signing transaction...");
  const tx = {
    to: CONTRACT_ADDRESS,
    nonce,
    gasPrice: hexValue(gasPriceRaw),
    gasLimit: hexValue(gasLimit),
    data,
    chainId,
    value: "0x0",
  };

  // Wallet.signTransaction 来自 @ethersproject/wallet —— 不依赖 Provider/network 检测
  const signedTx = await wallet.signTransaction(tx);
  console.log(`[onChainSave] signedTx length=${signedTx.length}`);

  // 6) 发送
  console.log("[onChainSave] sending raw transaction...");
  const txHash = await sendRawTransaction(signedTx);
  console.log(`[onChainSave] txHash=${txHash}`);

  // 7) 等待确认
  console.log("[onChainSave] waiting for transaction receipt...");
  const receipt = await waitForTransaction(txHash);
  console.log(`[onChainSave] receipt status=${receipt.status}`);

  if (receipt.status !== 1) {
    console.error(`[onChainSave] transaction FAILED: txHash=${txHash}, status=${receipt.status}`);
    throw new TransactionFailedError(
      txHash,
      `Transaction reverted on-chain: ${txHash}`
    );
  }

  console.log(`[onChainSave] transaction SUCCESS: txHash=${txHash}, familyIdBytes32=${familyIdBytes32}`);
  return { txHash, familyIdBytes32 };
}

export async function POST(request: NextRequest) {
  try {
    // 检查环境变量
    if (!W3S_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Pinata token not configured" },
        { status: 500 }
      );
    }
    if (!CONTRACT_ADDRESS || !CONTRACT_PRIVATE_KEY || !ALCHEMY_POLYGON_RPC_URL) {
      return NextResponse.json(
        { success: false, error: "Blockchain config not fully set" },
        { status: 500 }
      );
    }

    const contentType = request.headers.get("content-type") || "";

    // ===================== 模式1：multipart/form-data（文件上传） =====================
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const familyName = formData.get("familyName") as string | null;

      if (!familyName || !familyName.trim()) {
        return NextResponse.json(
          { success: false, error: "缺少 familyName" },
          { status: 400 }
        );
      }

      // 收集上传的图片文件
      const imageEntries = formData.getAll("imageFiles") as File[];
      const imageFiles: File[] = imageEntries.filter((f) => f instanceof File);

      // 上传图片到 IPFS
      let ipfsDirCid: string | null = null;
      if (imageFiles.length > 0) {
        ipfsDirCid = await uploadFilesToIPFS(imageFiles, W3S_TOKEN);
      }

      // 打包元数据上传
      const metadata = {
        familyName: familyName.trim(),
        ipfsDirCid,
        imageCount: imageFiles.length,
        timestamp: Date.now(),
      };

      const finalCID = await uploadMetadata(metadata, W3S_TOKEN);

      // 上链存证
      const { txHash, familyIdBytes32 } = await onChainSave(finalCID);

      // 绑定创建者邮箱（JWT 验证）
      const emailHash = getEmailHashFromRequest(request);
      if (emailHash) {
        writeFamilyBinding(emailHash, familyIdBytes32, familyName.trim());
        writeCreatorMeta(emailHash, familyIdBytes32, familyName.trim(), false);
      }

      return NextResponse.json({
        success: true,
        familyId: familyIdBytes32,
        txHash,
        viewUrl: `/family/${familyIdBytes32}`,
        ipfsCID: finalCID,
      });
    }

    // ===================== 模式2：application/json（家族树 JSON） =====================
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();

      // 基础校验：必须是对象且有 familyName 和 members
      if (typeof body !== "object" || body === null) {
        return NextResponse.json(
          { success: false, error: "请求体必须是 JSON 对象" },
          { status: 400 }
        );
      }

      const tree = body as Record<string, unknown>;

      if (typeof tree.familyName !== "string" || !tree.familyName.trim()) {
        return NextResponse.json(
          { success: false, error: "缺少或无效的 familyName" },
          { status: 400 }
        );
      }

      if (!Array.isArray(tree.members)) {
        return NextResponse.json(
          { success: false, error: "缺少或无效的 members 数组" },
          { status: 400 }
        );
      }

      // 补全时间戳字段（如果客户端没传）
      const now = new Date().toISOString();
      const familyTree: FamilyTree = {
        familyName: tree.familyName as string,
        members: tree.members,
        version: typeof tree.version === "string" ? tree.version : "1.0",
        createdAt: typeof tree.createdAt === "string" ? tree.createdAt : now,
        updatedAt: typeof tree.updatedAt === "string" ? tree.updatedAt : now,
        searchable: typeof tree.searchable === "boolean" ? tree.searchable : false,
        familyEvents: Array.isArray(tree.familyEvents) ? tree.familyEvents : undefined,
        album: Array.isArray(tree.album) ? tree.album : undefined,
      };

      // 序列化为 JSON 字符串并上传到 IPFS
      const metadata = {
        type: "family-tree",
        data: familyTree,
        timestamp: Date.now(),
      };

      const finalCID = await uploadMetadata(metadata, W3S_TOKEN);

      // 上链存证
      const { txHash, familyIdBytes32 } = await onChainSave(finalCID);

      // 绑定创建者邮箱（JWT 验证）
      const emailHash = getEmailHashFromRequest(request);
      if (emailHash) {
        writeFamilyBinding(emailHash, familyIdBytes32, familyTree.familyName);
        writeCreatorMeta(emailHash, familyIdBytes32, familyTree.familyName, familyTree.searchable || false);
      }
      // 更新 memberCount（即使没有登录也在元数据中更新）
      updateFamilyMetaMemberCount(familyIdBytes32, familyTree.members.length);

      return NextResponse.json({
        success: true,
        familyId: familyIdBytes32,
        txHash,
        viewUrl: `/family/${familyIdBytes32}`,
        ipfsCID: finalCID,
      });
    }

    // ===================== 不支持的 Content-Type =====================
    return NextResponse.json(
      {
        success: false,
        error: `不支持的 Content-Type: ${contentType}。请使用 multipart/form-data 或 application/json`,
      },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("save-family API error:", error);

    // 模拟执行失败（revert）→ 返回 400 + 错误信息
    if (error instanceof SimulationError) {
      console.log("[POST] simulation failed, returning 400");
      return NextResponse.json(
        { success: false, error: `模拟执行失败: ${error.message}` },
        { status: 400 }
      );
    }

    // 交易已发送但链上执行失败 → 返回 500 + txHash
    if (error instanceof TransactionFailedError) {
      console.log("[POST] transaction failed on-chain, returning 500 with txHash");
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          txHash: error.txHash,
        },
        { status: 500 }
      );
    }

    // 其他错误
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}