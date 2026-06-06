const { ethers } = require("ethers");
const solc = require("solc");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") });

async function main() {
  const privateKey = process.env.CONTRACT_PRIVATE_KEY;
  const alchemyUrl = process.env.ALCHEMY_POLYGON_RPC_URL;

  if (!privateKey) {
    throw new Error("缺少环境变量: CONTRACT_PRIVATE_KEY");
  }
  if (!alchemyUrl) {
    throw new Error("缺少环境变量: ALCHEMY_POLYGON_RPC_URL");
  }

  // 1. 读取 Solidity 合约源码
  const contractPath = path.resolve(__dirname, "..", "contracts", "FamilyRecord.sol");
  const source = fs.readFileSync(contractPath, "utf8");

  // 2. 编译合约
  const input = {
    language: "Solidity",
    sources: {
      "FamilyRecord.sol": {
        content: source,
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const contractFile = output.contracts["FamilyRecord.sol"]["FamilyRecord"];
  if (!contractFile) {
    console.error("编译输出:", JSON.stringify(output.errors, null, 2));
    throw new Error("合约编译失败");
  }

  const abi = contractFile.abi;
  const bytecode = contractFile.evm.bytecode.object;

  console.log("合约编译成功");

  // 3. 连接 Provider 和钱包
  const provider = new ethers.providers.JsonRpcProvider(alchemyUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("部署账户地址:", wallet.address);

  // 4. 获取当前 gas 价格（Polygon 主网最低要求）
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = ethers.utils.parseUnits("30", "gwei");  // 30 Gwei
  const maxFeePerGas = feeData.maxFeePerGas?.gt(ethers.utils.parseUnits("35", "gwei"))
    ? feeData.maxFeePerGas
    : ethers.utils.parseUnits("35", "gwei");

  // 5. 部署合约
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy({
    maxPriorityFeePerGas,
    maxFeePerGas,
  });

  await contract.deployed();

  console.log("\n✅ 合约已部署至地址:", contract.address);
  console.log(`请将以上地址填入 .env.local 的 CONTRACT_ADDRESS=`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });