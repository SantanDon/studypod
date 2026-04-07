import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Force Vercel to bundle backend dependencies
import 'deep-email-validator';
import 'bcryptjs';
import 'jsonwebtoken';
import 'drizzle-orm';
import '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (req, res) => {
  try {
    // The Express backend is now co-located under api/_backend/ to ensure Vercel bundles correctly
    const serverPath = path.resolve(__dirname, '_backend/server.js');
    console.log('API Bridge: Loading backend from', serverPath);
    
    if (!fs.existsSync(serverPath)) {
      return res.status(500).json({
        error: 'Backend initialization failed',
        message: 'server.js not found at ' + serverPath,
        cwd: process.cwd(),
        apiDir: __dirname,
        rootContents: fs.readdirSync(path.dirname(__dirname))
      });
    }

    // Dynamic import of the Express app
    const module = await import(serverPath);
    const app = module.default || module;
    
    // Bridge the Vercel request/response to the Express app
    return app(req, res);
  } catch (error) {
    console.error('Fatal API Bridge Error:', error);
    return res.status(500).json({
      error: 'API Bridge Crash',
      message: error.message,
      stack: error.stack,
      code: error.code
    });
  }
};
