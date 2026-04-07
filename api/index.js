import app from '../backend/src/server.js';
import { initializeDatabase } from '../backend/src/db/database.js';

let initialized = false;

export default async (req, res) => {
  try {
    if (!initialized) {
      console.log('🚀 Bootstrapping serverless environment...');
      await initializeDatabase();
      initialized = true;
    }
    return app(req, res);
  } catch (error) {
    console.error('SERVERLESS_BOOT_ERROR:', error);
    res.status(500).json({
      error: 'Module or Architecture Error',
      message: error.message,
      stack: error.stack,
      hint: 'This usually indicates a native dependency crash or binary mismatch on Vercel.'
    });
  }
};
