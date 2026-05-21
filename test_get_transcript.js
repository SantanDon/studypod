const videoId = 'dQw4w9WgXcQ';
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
  
  // 1. Extract INNERTUBE_API_KEY
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || html.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
  if (!apiKeyMatch) {
    console.error('Could not find INNERTUBE_API_KEY');
    return;
  }
  const apiKey = apiKeyMatch[1];
  console.log('Extracted API Key:', apiKey);

  // 1.5 Extract INNERTUBE_CLIENT_VERSION
  const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || html.match(/"clientVersion"\s*:\s*"([^"]+)"/);
  const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20260518.01.00';
  console.log('Extracted Client Version:', clientVersion);

  // 1.6 Extract visitorData
  const visitorDataMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/) || html.match(/"visitor_data"\s*:\s*"([^"]+)"/);
  const visitorData = visitorDataMatch ? visitorDataMatch[1] : undefined;
  console.log('Extracted Visitor Data:', visitorData);

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');

  // 2. Extract getTranscriptEndpoint params
  const paramsMatch = html.match(/"getTranscriptEndpoint"\s*:\s*{\s*"params"\s*:\s*"([^"]+)"/);
  if (!paramsMatch) {
    console.error('Could not find getTranscriptEndpoint params');
    return;
  }
  const params = paramsMatch[1];
  console.log('Extracted Params:', params);

  // 3. Call v1/get_transcript
  console.log('Calling get_transcript API...');
  const apiRes = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': url,
      'Cookie': sessionCookie,
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': clientVersion,
      'X-Goog-Visitor-Id': visitorData
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
      params,
      externalVideoId: videoId
    })
  });

  console.log('API Status:', apiRes.status, apiRes.statusText);
  const data = await apiRes.json();
  console.log('Response Keys:', Object.keys(data));
  
  // Print a portion of the response to see the transcript structure
  if (data.actions) {
    console.log('Found actions! Snippet:');
    console.log(JSON.stringify(data.actions, null, 2).substring(0, 1500));
  } else {
    console.log('Raw response:', JSON.stringify(data, null, 2).substring(0, 1000));
  }
}

main().catch(console.error);
