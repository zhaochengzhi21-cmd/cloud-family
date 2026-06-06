require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env.local") });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    polygon: {
      url: process.env.ALCHEMY_POLYGON_RPC_URL || "",
      accounts: process.env.CONTRACT_PRIVATE_KEY
        ? [process.env.CONTRACT_PRIVATE_KEY]
        : [],
    },
  },
};