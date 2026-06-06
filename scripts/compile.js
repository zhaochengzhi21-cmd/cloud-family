const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractPath = path.resolve(__dirname, '..', 'contracts', 'FamilyRecord.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'FamilyRecord.sol': { content: source }
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode'] }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const contractFile = output.contracts['FamilyRecord.sol']['FamilyRecord'];

if (!contractFile) {
  console.error('编译错误:', JSON.stringify(output.errors, null, 2));
  process.exit(1);
}

const abi = contractFile.abi;
const bytecode = contractFile.evm.bytecode.object;

const jsonPath = path.resolve(__dirname, '..', 'src/lib/FamilyRecord.json');
fs.writeFileSync(jsonPath, JSON.stringify({ abi }, null, 2));

console.log('=== ABI 输出 ===');
console.log(JSON.stringify(abi, null, 2));
console.log('\n=== BYTECODE ===');
console.log(bytecode.substring(0, 100) + '...');