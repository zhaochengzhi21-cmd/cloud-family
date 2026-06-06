/**
 * 独立查询 Polygon 主网合约 —— 使用 @ethersproject/keccak256 计算选择器
 *
 * 用法: node scripts/checkChain.js
 *
 * 查询合约: 0x0504ec8348227769484A81b52E3b948932d25840
 * 方法: familyDataHash(bytes32) → string
 * 函数选择器: keccak256("familyDataHash(bytes32)") 的前 4 字节
 */

const { keccak256 } = require("@ethersproject/keccak256");
const https = require("https");

// ======== 配置 ========
const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/mwIUaue0W9jUBd7fabXPF";
const CONTRACT = "0x0504ec8348227769484A81b52E3b948932d25840";
const FAMILY_ID = "0x5c4448acd1c81692fc53e15ba7abf10906d0c0e7ec5cf24278192321fd8d1c8d";

// ======== 用 @ethersproject/keccak256 计算函数选择器 ========
// familyDataHash(bytes32) 的前 4 字节
const sigHash = keccak256(Buffer.from("familyDataHash(bytes32)")).slice(0, 10);

// 参数：bytes32 familyId（补到 64 个 hex 字符）
const param = FAMILY_ID.startsWith("0x") ? FAMILY_ID.slice(2).padStart(64, "0") : FAMILY_ID.padStart(64, "0");
const data = sigHash + param;

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Polygon 链上数据查询");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  合约:     ${CONTRACT}`);
console.log(`  familyId: ${FAMILY_ID}`);
console.log(`  选择器:   ${sigHash} (keccak256("familyDataHash(bytes32)"))`);
console.log(`  calldata: ${data}`);
console.log("");

// ======== 调用 eth_call ========
const requestBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "eth_call",
  params: [
    {
      to: CONTRACT,
      data: data,
    },
    "latest",
  ],
});

const options = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
};

async function rpcCall(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            reject(new Error("解析 JSON 响应失败: " + responseData));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ======== 解析返回值 ========
// Solidity 中 string 的 ABI 编码: 偏移量(32字节) | 长度(32字节) | 数据(按32字节对齐)
function decodeString(hexResult) {
  const raw = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;

  // 空数据
  if (!raw || raw === "" || raw === "0") {
    return null;
  }

  // 最小长度: 偏移量(64hex) + 长度(64hex) = 128 hex
  if (raw.length < 128) {
    return null;
  }

  const offset = parseInt(raw.slice(0, 64), 16); // 偏移量（通常为 0x20 = 32）
  const strLen = parseInt(raw.slice(64, 128), 16); // 字符串字节长度
  const dataHex = raw.slice(128, 128 + strLen * 2); // 实际字符串 hex

  if (strLen === 0 || !dataHex) {
    return null;
  }

  return Buffer.from(dataHex, "hex").toString("utf8");
}

(async () => {
  try {
    const result = await rpcCall(RPC_URL, requestBody);

    console.log("📡 RPC 原始响应:");
    console.log(JSON.stringify(result, null, 2));
    console.log("");

    if (result.error) {
      // 如果合约 revert（比如 mapping 中无此 key）
      if (
        result.error.code === 3 ||
        (result.error.message && result.error.message.includes("revert"))
      ) {
        console.log("❌ 链上无数据（execution reverted）");
      } else {
        console.log("❌ RPC 错误:", result.error.message);
      }
      process.exitCode = 1;
      return;
    }

    const hexResult = result.result;
    console.log("📦 eth_call 原始返回 hex:", hexResult);

    if (!hexResult || hexResult === "0x" || hexResult === "0x0") {
      console.log("\n❌ 链上无数据（返回空 0x）");
      process.exitCode = 1;
      return;
    }

    const decoded = decodeString(hexResult);

    if (decoded) {
      console.log("\n✅ IPFS CID / 数据哈希:", decoded);
    } else {
      console.log("\n⚠️  返回了非空 hex 但无法解析为 string，原始 hex 如上");
    }
  } catch (err) {
    console.error("❌ 请求失败:", err.message);
    process.exitCode = 1;
  }
})();