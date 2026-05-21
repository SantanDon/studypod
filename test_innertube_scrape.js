const videoId = 'HLcfdCsrouA';
const url = `https://www.youtube.com/watch?v=${videoId}`;

async function main() {
  console.log(`Fetching page ${url}...`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  
  // Extract credentials
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || html.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
  if (!apiKeyMatch) {
    console.error('Could not find INNERTUBE_API_KEY');
    return;
  }
  const apiKey = apiKeyMatch[1];
  console.log('Extracted API Key:', apiKey);

  const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || html.match(/"clientVersion"\s*:\s*"([^"]+)"/);
  const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20260518.01.00';
  console.log('Extracted Client Version:', clientVersion);

  const visitorDataMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/) || html.match(/"visitor_data"\s*:\s*"([^"]+)"/);
  const visitorData = visitorDataMatch ? visitorDataMatch[1] : undefined;
  console.log('Extracted Visitor Data:', visitorData);

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');

  // Call player API
  console.log('Calling player API...');
  const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': url,
      'Cookie': sessionCookie
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: clientVersion,
          originalUrl: url,
          visitorData: visitorData,
          hl: 'en',
          gl: 'US'
        }
      },
      videoId
    })
  });

  console.log('Player API Status:', playerRes.status, playerRes.statusText);
  const playerData = await playerRes.json();
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log('Caption Tracks found:', captionTracks.length);
  if (captionTracks.length > 0) {
    console.log('Tracks snippet:', captionTracks.map(t => ({ languageCode: t.languageCode, v: t.v, kind: t.kind })));
  } else {
    console.log('No captions in player response. Full keys:', Object.keys(playerData));
  }
}

main().catch(console.error);
