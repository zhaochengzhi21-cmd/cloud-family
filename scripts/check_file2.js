const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'app', 'create-tree', 'page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
// Show last 5 lines
for (let i = Math.max(0, lines.length - 5); i < lines.length; i++) {
  console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
}
// Check bytes at end
const buf = fs.readFileSync(filePath);
console.log('File size:', buf.length);
const lastBytes = buf.slice(-100);
console.log('Last 100 bytes hex:', lastBytes.toString('hex'));
console.log('Last 100 bytes utf8:', lastBytes.toString('utf8'));