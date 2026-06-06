const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'app', 'create-tree', 'page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
console.log('Length:', content.length);
console.log('Ends with:', JSON.stringify(content.slice(-300)));