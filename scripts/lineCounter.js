const fs = require('fs');
const path = require('path');

function countLines(filePath) {
  return new Promise((resolve) => {
    let count = 0;
    fs.createReadStream(filePath)
      .on('data', chunk => {
        for (let i = 0; i < chunk.length; ++i) if (chunk[i] === 10) count++;
      })
      .on('end', () => resolve(count));
  });
}

async function findGodFiles(dir) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      await findGodFiles(res);
    } else if (res.endsWith('tsx') || res.endsWith('ts')) {
      const lines = await countLines(res);
      if (lines > 350) {
        console.log(`${lines.toString().padStart(4, ' ')} lines: ${res}`);
      }
    }
  }
}

findGodFiles('./src/components');
findGodFiles('./src/pages');
