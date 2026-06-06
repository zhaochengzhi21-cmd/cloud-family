/**
 * forceNonce.js
 *
 * 功能：
 * 1. 使用 eth_getTransactionCount(pending) 获取当前 pending nonce
 * 2. 用该 nonce 向自己地址发送 0 POL 空转账
 * 3. gasPrice = 当前网络建议值 × 1.5
 * 4. 私钥签名 → eth_sendRawTransaction 广播 → 输出 txHash
 *
 * 用法: node scripts/forceNonce.js
 */

const https = require("https");

// ======== 配置 ========
const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/mwIUaue0W9jUBd7fabXPF";
const PRIVATE_KEY = "0xfa1facf002b8b71f8922a8eeff9a46fde278f7bca35b2bd0536e9bd6786ff094";

// ======== RPC 调用 (原生 https, 不依赖 ethers Provider) ========
function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(RPC_URL);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("JSON 解析失败: " + data));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  try {
    const { Wallet } = require("@ethersproject/wallet");

    // ---------- 1. 钱包 ----------
    const wallet = new Wallet(PRIVATE_KEY);
    const from = wallet.address;
    const to = from; // 向自己转账

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  forceNonce — 广播 0 POL 空转账");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  发送地址: ${from}`);
    console.log(`  接收地址: ${to}`);
    console.log("");

    // ---------- 2. 获取 pending nonce ----------
    const nonceRes = await rpcCall({
      jsonrpc: "2.0", id: 1,
      method: "eth_getTransactionCount",
      params: [from, "pending"],
    });
    if (nonceRes.error) throw new Error("非ce获取失败: " + nonceRes.error.message);
    const nonce = parseInt(nonceRes.result, 16);
    console.log(`  📊 pending nonce: ${nonce}`);
    console.log("");

    // ---------- 3. 获取 gasPrice 并 ×1.5 ----------
    const gasPriceRes = await rpcCall({
      jsonrpc: "2.0", id: 2,
      method: "eth_gasPrice",
      params: [],
    });
    if (gasPriceRes.error) throw new Error("gasPrice获取失败: " + gasPriceRes.error.message);
    const baseGasPrice = BigInt(gasPriceRes.result);
    const boostedGasPrice = (baseGasPrice * 15n) / 10n; // ×1.5

    // ---------- 4. 获取 chainId ----------
    const chainRes = await rpcCall({
      jsonrpc: "2.0", id: 3,
      method: "eth_chainId",
      params: [],
    });
    if (chainRes.error) throw new Error("chainId获取失败: " + chainRes.error.message);
    const chainId = parseInt(chainRes.result, 16);

    // ---------- 5. 构造交易 ----------
    const tx = {
      from,
      to,
      nonce,
      gasPrice: "0x" + boostedGasPrice.toString(16),
      gasLimit: "0x5208", // 21000 (标准转账 gas)
      value: "0x0",        // 0 POL
      chainId,
    };

    console.log(`  交易参数:`);
    console.log(`    nonce:       ${nonce}`);
    console.log(`    gasPrice:    ${boostedGasPrice} wei (基础 ${baseGasPrice} × 1.5)`);
    console.log(`    gasLimit:    21000`);
    console.log(`    value:       0 POL`);
    console.log(`    chainId:     ${chainId}`);
    console.log("");

    // ---------- 6. 签名 ----------
    // Wallet.signTransaction 来自 @ethersproject/wallet，不依赖 Provider
    const signedTx = await wallet.signTransaction(tx);
    console.log("  ✅ 交易已签名");

    // ---------- 7. 广播 ----------
    const sendRes = await rpcCall({
      jsonrpc: "2.0", id: 4,
      method: "eth_sendRawTransaction",
      params: [signedTx],
    });

    if (sendRes.error) {
      throw new Error("广播失败: " + JSON.stringify(sendRes.error));
    }

    const txHash = sendRes.result;
    console.log(`  🚀 交易已广播!`);
    console.log(`  txHash: ${txHash}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (err) {
    console.error("❌ 错误:", err.message);
    process.exitCode = 1;
  }
})();