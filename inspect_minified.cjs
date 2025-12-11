
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'dist/assets/index-DU0UfT4u.js');

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  if (lines.length >= 229) {
    const line229 = lines[228]; // 0-indexed
    console.log(`Line 229 length: ${line229.length}`);
    
    // Check around 7280
    const start = Math.max(0, 7280 - 300);
    const end = Math.min(line229.length, 7280 + 300);
    
    console.log(`Snippet around 229:7280:`);
    console.log(line229.substring(start, end));
    
  } else {
    console.log(`File has only ${lines.length} lines.`);
  }
} catch (e) {
  console.error(e);
}
