export default async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  try {
    const pageResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const htmlText = await pageResponse.text();

    const contentType = pageResponse.headers.get('content-type');
    if (contentType) {
        res.setHeader('Content-Type', contentType);
    } else {
        res.setHeader('Content-Type', 'text/html');
    }

    return res.status(pageResponse.status || 200).send(htmlText);
  } catch (error) {
     return res.status(500).json({ error: error.message || 'Proxy request failed' });
  }
};
