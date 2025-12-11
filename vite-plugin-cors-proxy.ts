import { Plugin } from 'vite';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

// Helper to follow redirects and fetch content
function fetchWithRedirects(targetUrl: string, maxRedirects = 5): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new URL(targetUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity', // Don't request compression for simplicity
      },
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).toString();
        console.log(`[Proxy] Following redirect: ${res.statusCode} -> ${redirectUrl}`);
        fetchWithRedirects(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

export function corsProxyPlugin(): Plugin {
  return {
    name: 'configure-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/proxy')) {
          const urlParams = new URL(req.url, `http://${req.headers.host}`);
          const targetUrl = urlParams.searchParams.get('url');

          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing "url" query parameter' }));
            return;
          }

          console.log(`[Proxy] Fetching: ${targetUrl}`);

          try {
            const result = await fetchWithRedirects(targetUrl);
            
            console.log(`[Proxy] Response: ${result.statusCode}, Size: ${result.body.length} bytes`);

            // Set CORS headers to allow the request
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            // Forward content-type if present
            if (result.headers['content-type']) {
              res.setHeader('Content-Type', result.headers['content-type']);
            }
            
            res.statusCode = result.statusCode;
            res.end(result.body);
          } catch (error) {
            console.error('[Proxy] Error:', error);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Proxy error: ${(error as Error).message}` }));
          }
        } else if (req.url?.startsWith('/api/youtube-transcript')) {
          // Handle CORS preflight
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 204;
            res.end();
            return;
          }

          const urlParams = new URL(req.url, `http://${req.headers.host}`);
          const videoUrl = urlParams.searchParams.get('url');

          if (!videoUrl) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing "url" query parameter' }));
            return;
          }

          console.log(`[YouTube API] Fetching transcript for: ${videoUrl}`);

          try {
            const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
            
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(transcript));
          } catch (error) {
            console.error('[YouTube API] Error:', error);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (error as Error).message || 'Failed to fetch transcript' }));
          }
        } else {
          next();
        }
      });
    },
  };
}
