import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

export interface YoutubeTranscriptResult {
  url: string;
  title: string;
  description?: string;
  content: string;
  metadata: {
    duration?: number;
    author?: string;
    videoId?: string;
  };
}

/**
 * Extract video ID from various YouTube URL formats
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Decode HTML entities in transcript text
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&#39;': "'",
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&#x27;': "'",
    '&#x2F;': '/',
    '&apos;': "'",
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  // Handle numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}

/**
 * Extract title from YouTube page HTML
 */
function extractTitle(html: string, videoId: string, url: string): string {
  // Try multiple patterns for title extraction
  const titlePatterns = [
    /<meta\s+name="title"\s+content="([^"]+)"/i,
    /<meta\s+property="og:title"\s+content="([^"]+)"/i,
    /<title>([^<]+)<\/title>/i,
    /"title"\s*:\s*{\s*"runs"\s*:\s*\[\s*{\s*"text"\s*:\s*"([^"]+)"/,
    /"videoDetails"[^}]*"title"\s*:\s*"([^"]+)"/,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const title = match[1]
        .replace(/ - YouTube$/, '')
        .replace(/\\u0026/g, '&')
        .trim();
      if (title.length > 0 && title.length < 500) {
        return decodeHtmlEntities(title);
      }
    }
  }

  return `YouTube Video: ${videoId || url}`;
}

/**
 * Extract description from YouTube page HTML
 */
function extractDescription(html: string): string {
  const patterns = [
    /<meta\s+name="description"\s+content="([^"]+)"/i,
    /<meta\s+property="og:description"\s+content="([^"]+)"/i,
    /"shortDescription"\s*:\s*"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }
  return "";
}

export async function extractYoutubeTranscript(url: string): Promise<YoutubeTranscriptResult> {
  console.log('🎬 Starting YouTube transcript extraction for:', url);

  // Validate URL
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    throw new Error('Invalid YouTube URL. Please provide a valid YouTube video link.');
  }

  // Extract video ID
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Could not extract video ID from URL. Please check the URL format.');
  }
  console.log('📺 Video ID:', videoId);

  // Normalize URL to standard watch format
  const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // 1. Fetch video page via proxy (Mainly for Title and Validation)
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(normalizedUrl)}`;
    console.log('📡 Fetching video page via proxy for metadata...');

    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video page: HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Check if video is available
    if (html.includes('Video unavailable') || html.includes('is not available')) {
      throw new Error('This video is not available. It may be private, deleted, or age-restricted.');
    }

    // Extract title
    const title = extractTitle(html, videoId, url);
    console.log(`📝 Extracted Title: ${title}`);

    // Extract description
    const description = extractDescription(html);
    console.log(`📝 Extracted Description: ${description.substring(0, 100)}...`);

    // 2. Fetch transcript via server-side API (using youtube-transcript lib)
    console.log('📡 Fetching transcript via server API...');
    const apiUrl = `/api/youtube-transcript?url=${encodeURIComponent(normalizedUrl)}`;
    const transcriptResponse = await fetch(apiUrl);

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      let errorMessage = `Failed to fetch transcript: HTTP ${transcriptResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = errorJson.error;
        }
      } catch (e) {
        // ignore json parse error
      }
      throw new Error(errorMessage);
    }

    const transcriptData = await transcriptResponse.json();
    
    if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
       throw new Error("Received empty transcript from YouTube.");
    }

    // 3. Process transcript
    let content = "";
    let duration = 0;

    // The library returns an array of objects: { text: string, duration: number, offset: number }
    for (const item of transcriptData) {
        content += item.text + " ";
    }
    
    if (transcriptData.length > 0) {
        const lastItem = transcriptData[transcriptData.length - 1];
        // offset and duration are in ms
        duration = (lastItem.offset + lastItem.duration) / 1000;
    }

    console.log(`✅ Successfully extracted transcript: ${content.length} characters, ${Math.round(duration)}s duration`);

    return {
      url: normalizedUrl,
      title,
      description,
      content: content.trim(),
      metadata: {
        duration: Math.round(duration),
        videoId,
      },
    };
  } catch (error) {
    console.error('❌ Failed to extract YouTube transcript:', error);

    // Provide more helpful error messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    if (errorMessage.includes('Failed to fetch')) {
      throw new Error(`Network error while accessing YouTube. Please check your internet connection and try again.`);
    }

    throw new Error(`Failed to extract transcript: ${errorMessage}`);
  }
}
