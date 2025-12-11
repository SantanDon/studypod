
const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== '.git' && file !== 'dist') { // Skip .git and dist
        searchDir(fullPath);
      }
    } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.jsx')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('Object.forEach')) {
          console.log(`Found 'Object.forEach' in: ${fullPath}`);
          // Print surrounding lines
          const lines = content.split('\n');
          lines.forEach((line, i) => {
            if (line.includes('Object.forEach')) {
              console.log(`  Line ${i + 1}: ${line.trim().substring(0, 100)}...`);
            }
          });
        }
      } catch (e) {
        console.error(`Error reading ${fullPath}: ${e.message}`);
      }
    }
  }
}

console.log('Searching for Object.forEach in src and node_modules...');
searchDir('src');
searchDir('node_modules'); // This might differ in recursion depth or exclusions
console.log('Search complete.');
