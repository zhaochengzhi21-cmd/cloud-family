const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'app', 'create-tree', 'page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
// Check lines 852-860
for (let i = 849; i < Math.min(861, lines.length); i++) {
  console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
}
// Check for non-ASCII invisible characters
const relevantSection = content.slice(0, 10000);
const match = relevantSection.match(/[\u200B-\u200D\uFEFF\u2028\u2029]/);
if (match) {
  console.log('Found invisible char at position:', match.index, 'char code:', match[0].charCodeAt(0));
} else {
  console.log('No invisible chars found in first 10000 chars');
}