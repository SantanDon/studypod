import express from 'express';
import { URL } from 'url';
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * GET /proxy
 * Generic CORS proxy for web scraping
 */
router.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      throw new AppError(400, 'MISSING_URL', 'URL parameter is required');
    }

    const decodedUrl = decodeURIComponent(url);
    console.log(`[Proxy] Fetching: ${decodedUrl}`);

    // Validate URL
    try {
      new URL(decodedUrl);
    } catch (e) {
      throw new AppError(400, 'INVALID_URL', 'Invalid URL provided');
    }

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow', 
      follow: 5
    });

    if (!response.ok) {
       // Forward the status code from the target
      return res.status(response.status).send(`Failed to fetch content: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    // Pipe the response body to the client
    response.body.pipe(res);

  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[Proxy] Error:', error);
    throw new AppError(500, 'PROXY_FAILED', error.message || 'Failed to proxy request');
  }
});

export default router;
