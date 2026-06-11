import { NextRequest, NextResponse } from "next/server";
import { defaultAbiCoder } from "@ethersproject/abi";

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const ALCHEMY_POLYGON_RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || "";

import { fetchJsonFromIpfs } from "@/lib/ipfsGateway";

/**
 * familyDataHash(bytes32) 的函数签名 keccak256 前 4 字节 = 0x65023a23
 * 硬编码避免运行时计算
 */
const FAMILY_DATA_HASH_SELECTOR = "65023a23";

// ---------- 用原生 fetch 调用 RPC ----------
async function rpcCall(
  method: string,
  params: unknown[]
): Promise<unknown> {
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
    throw new Error(
      `RPC call ${method} failed: ${res.status} ${res.statusText}`
    );
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  }

  return json.result;
}

/** 调用合约只读方法 */
async function callContract(data: string): Promise<string> {
  const result = await rpcCall("eth_call", [
    {
      to: CONTRACT_ADDRESS,
      data,
    },
    "latest",
  ]);
  return result as string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;

    if (!familyId || !familyId.startsWith("0x") || familyId.length !== 66) {
      return NextResponse.json(
        {
          success: false,
          error: "无效的 familyId，应为 32 字节的十六进制字符串",
        },
        { status: 400 }
      );
    }

    if (!CONTRACT_ADDRESS || !ALCHEMY_POLYGON_RPC_URL) {
      return NextResponse.json(
        { success: false, error: "Blockchain config not fully set" },
        { status: 500 }
      );
    }

    // 1. 构造 eth_call 的 data（手工 ABI 编码，零依赖 ethers）
    const familyIdHex = familyId.startsWith("0x") ? familyId.slice(2) : familyId;
    const data =
      "0x" +
      FAMILY_DATA_HASH_SELECTOR +
      familyIdHex.padStart(64, "0");

    // 2. 执行 eth_call
    const rawResult = await callContract(data);

    // 3. 用 @ethersproject/abi 的 defaultAbiCoder 解码返回值
    //    返回值是 ABI 编码的 string: (offset, length, data)
    const decoded = defaultAbiCoder.decode(["string"], rawResult);
    const dataHash: string = decoded[0];

    // 4. 如果返回空字符串，说明该 familyId 不存在
    if (!dataHash || dataHash.trim() === "") {
      return NextResponse.json(
        { success: false, error: "未找到该家族的数据" },
        { status: 404 }
      );
    }

    // 5. 从 IPFS 网关获取 JSON 数据（自动重试切换网关，复用 ipfsGateway 库）
    const ipfsData = await fetchJsonFromIpfs(dataHash);

    if (!ipfsData) {
      return NextResponse.json({
        success: true,
        dataHash,
        ipfsData: null,
        warning: `合约中记录了 IPFS CID (${dataHash})，但从所有 IPFS 网关获取数据均失败`,
      });
    }

    // 6. 返回成功结果
    return NextResponse.json({
      success: true,
      familyId,
      dataHash,
      ipfsData,
    });
  } catch (error: unknown) {
    console.error("get-family API error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";

    // 如果合约调用失败（比如 familyId 不存在），返回 404
    if (message.includes("revert") || message.includes("execution reverted")) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的数据" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}