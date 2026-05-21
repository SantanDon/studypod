// API BRIDGE v1.0.4
import app from '../backend/src/server.js';

// Force Vercel to bundle dynamic/optional dependencies
import '@danielxceron/youtube-transcript';
import '@xenova/transformers';

export default async (req, res) => {
  try {
    // Bridge the Vercel request/response directly to the statically imported Express app
    return app(req, res);
  } catch (error) {
    console.error('Fatal API Bridge Error:', error);
    return res.status(500).json({
      error: 'API Bridge Crash',
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      hint: 'Check Vercel logs for full context.'
    });
  }
};
