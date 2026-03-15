const fs = require('fs');
const path = require('path');

function getFiles(dir, filesList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getFiles(fullPath, filesList);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      filesList.push(fullPath);
    }
  }
  return filesList;
}

const allFiles = getFiles(path.join(__dirname, 'src', 'components'));

const fileLines = allFiles.map(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n').length;
  return { file, lines };
});

fileLines.sort((a, b) => b.lines - a.lines);

console.log("Top 10 largest components:");
fileLines.slice(0, 10).forEach(f => {
  console.log(`${f.lines} lines: ${f.file.replace(__dirname, '')}`);
});
