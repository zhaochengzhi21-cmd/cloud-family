/**
 * 查询钱包地址的交易统计
 * 零项目修改，仅使用 @ethersproject/wallet 做密钥推导
 *
 * 用法: node scripts/checkWallet.js
 */

const https = require("https");

// ======== 配置 ========
const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/mwIUaue0W9jUBd7fabXPF";
const PRIVATE_KEY = "0xfa1facf002b8b71f8922a8eeff9a46fde278f7bca35b2bd0536e9bd6786ff094";
const CONTRACT = "0x0504ec8348227769484A81b52E3b948932d25840";

// ======== RPC 调用 ========
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

/**
 * 用 Polygonscan API 查询该地址发起的交易
 * 免费，无 rate limit 硬限制，但加一点延迟以防万一
 */
async function queryPolygonscan(address) {
  return new Promise((resolve, reject) => {
    const url = `https://api.polygonscan.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=999999999&sort=desc&apikey=YourApiKeyToken`;
    
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Polygonscan JSON 解析失败: " + data));
        }
      });
    }).on("error", reject);
  });
}

(async () => {
  try {
    const { Wallet } = require("@ethersproject/wallet");
    const wallet = new Wallet(PRIVATE_KEY);
    const address = wallet.address;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  钱包交易查询 (Polygon 主网)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  地址: ${address}`);
    console.log(`  合约: ${CONTRACT}`);
    console.log("");

    // 1. 获取 nonce (pending 模式下，包括未确认的)
    const nonceRes = await rpcCall({
      jsonrpc: "2.0", id: 1,
      method: "eth_getTransactionCount",
      params: [address, "latest"],
    });
    if (nonceRes.error) throw new Error("nonce获取失败: " + nonceRes.error.message);
    const latestNonce = parseInt(nonceRes.result, 16);
    console.log(`  📊 nonce (latest): ${latestNonce}`);
    console.log("");

    if (latestNonce === 0) {
      console.log("  ℹ️  该地址无任何交易");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return;
    }

    // 2. 查询 Polygonscan 获取交易列表
    console.log("  🔍 通过 Polygonscan API 查询交易列表...");
    console.log("");

    const psRes = await queryPolygonscan(address);

    if (psRes.status !== "1" || !psRes.result || !Array.isArray(psRes.result)) {
      console.log("  ⚠️  Polygonscan 查询失败或返回空:", psRes.message || "未知");
      console.log("");
      console.log("  转而尝试 eth_getLogs 分批扫描合约日志...");
      console.log("");

      // Plan B: eth_getLogs 分批扫描
      const blockRes = await rpcCall({
        jsonrpc: "2.0", id: 3,
        method: "eth_blockNumber",
        params: [],
      });
      if (blockRes.error) throw new Error("区块获取失败");
      const latestBlock = parseInt(blockRes.result, 16);

      let foundLogs = [];
      let scanned = 0;
      for (let end = latestBlock; end >= 0 && foundLogs.length < 3 && scanned < 1000; end -= 10) {
        const start = Math.max(0, end - 9);
        const fromHex = "0x" + start.toString(16);
        const toHex = "0x" + end.toString(16);
        scanned += 10;

        const logsRes = await rpcCall({
          jsonrpc: "2.0", id: 4,
          method: "eth_getLogs",
          params: [{
            address: CONTRACT,
            fromBlock: fromHex,
            toBlock: toHex,
          }],
        });

        if (logsRes.error) continue;
        if (logsRes.result && logsRes.result.length > 0) {
          foundLogs = foundLogs.concat(logsRes.result);
        }
      }

      if (foundLogs.length === 0) {
        console.log(`  ℹ️  扫描 ${scanned} 个区块未找到该合约的日志`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        return;
      }

      foundLogs.sort((a, b) => parseInt(b.blockNumber, 16) - parseInt(a.blockNumber, 16));
      const recent = foundLogs.slice(0, 3);

      console.log(`  📝 合约中共 ${foundLogs.length} 个事件，最近 ${recent.length} 条:`);
      console.log("");

      for (const log of recent) {
        const txHash = log.transactionHash;
        const blockNum = parseInt(log.blockNumber, 16);

        const receiptRes = await rpcCall({
          jsonrpc: "2.0", id: 5,
          method: "eth_getTransactionReceipt",
          params: [txHash],
        });

        let status = "未知", gasUsed = "";
        if (receiptRes.result) {
          status = receiptRes.result.status === "0x1" ? "✅ 成功" : "❌ 失败";
          gasUsed = parseInt(receiptRes.result.gasUsed, 16).toString();
        }

        console.log(`  txHash:   ${txHash}`);
        console.log(`  状态:     ${status}`);
        console.log(`  区块:     ${blockNum}`);
        console.log(`  gasUsed:  ${gasUsed}`);
        console.log("");
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return;
    }

    // Polygonscan 成功
    const txs = psRes.result;
    console.log(`  📝 Polygonscan 返回 ${txs.length} 笔交易，最近 ${Math.min(3, txs.length)} 笔:`);
    console.log("");

    const recentTxs = txs.slice(0, 3);
    for (const tx of recentTxs) {
      const status = tx.txreceipt_status === "1" ? "✅ 成功" : (tx.txreceipt_status === "0" ? "❌ 失败" : "未知");
      const isContractCall = tx.to?.toLowerCase() === CONTRACT.toLowerCase() && tx.input?.length > 10;

      console.log(`  txHash:   ${tx.hash}`);
      console.log(`  状态:     ${status}`);
      console.log(`  nonce:    ${tx.nonce}`);
      console.log(`  区块:     ${tx.blockNumber}`);
      console.log(`  to:       ${tx.to || "合约创建"}`);
      console.log(`  类型:     ${isContractCall ? "📄 合约调用" : "💸 普通转账"}`);
      console.log(`  value:    ${tx.value} wei`);
      console.log(`  gasUsed:  ${tx.gasUsed}`);
      console.log("");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (err) {
    console.error("❌ 错误:", err.message);
    process.exitCode = 1;
  }
})();