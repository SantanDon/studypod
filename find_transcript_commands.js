const videoId = 'dQw4w9WgXcQ';
const url = `https://www.youtube.com/watch?v=${videoId}`;

async function main() {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  
  const patterns = [/getTranscript/i, /transcript/i, /get_transcript/i];
  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern, 'gi');
    while ((match = regex.exec(html)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(html.length, match.index + 150);
      console.log(`Pattern ${pattern} match at index ${match.index}:`);
      console.log(html.substring(start, end));
      console.log('-'.repeat(40));
    }
  }
}

main().catch(console.error);
