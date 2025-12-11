import express from 'express';

import { URL } from 'url';

const router = express.Router();

/**
 * GET /proxy
 * Generic CORS proxy for web scraping
 */
router.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const decodedUrl = decodeURIComponent(url);
    console.log(`[Proxy] Fetching: ${decodedUrl}`);

    // Validate URL
    try {
      new URL(decodedUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL provided' });
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
    console.error('[Proxy] Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to proxy request' 
    });
  }
});

export default router;
