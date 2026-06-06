const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'app', 'create-tree', 'page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
process.stdout.write(content);