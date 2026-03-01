// Lightweight Vercel API handler
// NOTE: The Express backend is NOT needed for Vercel deployment
// All functionality (PDF extraction, AI calls, scraping) runs client-side

export default async function handler(req, res) {
  // Health check endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  return res.status(200).json({
    status: 'ok',
    message: 'StudyLM API - Use /api/firecrawl, /api/proxy, or /api/youtube-transcript',
    timestamp: new Date().toISOString(),
    deployment: 'vercel-serverless'
  });
}
