// Polyfill to parse HTML entities mapped previously in the framework
function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}



function parseXmlCaptions(xmlText) {
  const result = [];
  const textMatches = xmlText.match(/<text[^>]*>[\s\S]*?<\/text>/g);
  if (textMatches && textMatches.length > 0) {
    for (let idx = 0; idx < textMatches.length; idx++) {
      const match = textMatches[idx];
      const text = decodeHtmlEntities(match.replace(/<[^>]+>/g, ''));
      const startMatch = match.match(/start="([\d.]+)"/);
      const durMatch = match.match(/dur="([\d.]+)"/);
      if (text.length > 0) {
        result.push({
          text,
          offset: startMatch ? parseFloat(startMatch[1]) * 1000 : idx * 3000,
          duration: durMatch ? parseFloat(durMatch[1]) * 1000 : 3000,
        });
      }
    }
  }
  return result;
}

export default async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  if (!idMatch) return res.status(400).json({ error: 'Invalid url' });
  const videoId = idMatch[1];

  try {
     const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
         'Accept-Language': 'en-US,en;q=0.9',
         'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
         'Sec-Fetch-Dest': 'document',
       }
     });
     const html = await pageResponse.text();

     const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
     const apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyA8eiZmM1FaDVjRy-df2KoPYpae5kqj3Vk';

     // POST payload mimicking an Android client to bypass strict limits
     const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'X-YouTube-Client-Name': '3',
         'X-YouTube-Client-Version': '18.11.34',
         'Origin': 'https://www.youtube.com',
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
       },
       body: JSON.stringify({
         videoId,
         context: {
           client: {
             clientName: 'ANDROID',
             clientVersion: '20.10.38',
             androidSdkVersion: 30,
             userAgent: 'com.google.android.youtube/20.10.38(Linux; U; Android 11) gzip',
             hl: 'en',
             gl: 'US'
           }
         },
         contentCheckOk: true,
         racyCheckOk: true
       })
     });

     const playerData = await playerResponse.json();
     const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

     // Extract accurate metadata from the InnerTube JSON API response
     let metadata = {
        title: `YouTube Video: ${videoId}`,
        description: "",
        author: "Unknown Channel",
        keywords: []
     };

     const vDetails = playerData?.videoDetails;
     if (vDetails && vDetails.title) {
         metadata.title = vDetails.title;
         metadata.description = vDetails.shortDescription || "";
         metadata.author = vDetails.author || "Unknown Channel";
         metadata.keywords = vDetails.keywords || [];
     } else {
         // Fallback layer 3: oEmbed API if InnerTube returns empty due to Edge IP blocks
         try {
             const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
             if (oembedRes.ok) {
                 const oembed = await oembedRes.json();
                 if (oembed.title) metadata.title = oembed.title;
                 if (oembed.author_name) metadata.author = oembed.author_name;
             }
         } catch (e) {
             // Silently ignore oEmbed failures
         }
     }

     if (captionTracks.length > 0) {
        const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
        const captionResult = await fetch(track.baseUrl);
        const captionText = await captionResult.text();

        const transcript = parseXmlCaptions(captionText);
        if (transcript.length > 0) {
            return res.status(200).json({ transcript, metadata });
        }
     }
     
     // Even if there's no transcript, return the metadata. We can't parse text, but we extracted title/desc
     return res.status(200).json({ transcript: [], metadata, fallbackError: "No caption tracks available on Youtube" });
  } catch (error) {
     return res.status(500).json({ error: error.message });
  }
};
