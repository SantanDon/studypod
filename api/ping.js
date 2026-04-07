import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (req, res) => {
  const rootDir = process.cwd();
  const apiDir = __dirname;
  
  const structure = {
    cwd: rootDir,
    dirname: __dirname,
    rootContents: fs.readdirSync(rootDir),
    apiContents: fs.readdirSync(apiDir),
    backendExists: fs.existsSync(path.resolve(rootDir, 'backend')),
    serverExists: fs.existsSync(path.resolve(rootDir, 'backend/src/server.js')),
    env: Object.keys(process.env).filter(k => k.includes('TURSO'))
  };

  if (structure.backendExists) {
    structure.backendSrcContents = fs.readdirSync(path.resolve(rootDir, 'backend/src'));
  }

  res.status(200).json({
    status: 'diagnostic',
    time: new Date().toISOString(),
    structure
  });
};
