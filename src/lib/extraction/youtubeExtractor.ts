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
    keywords?: string[];
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
    console.log('📡 Fetching transcript and metadata via server API...');
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

    const payload = await transcriptResponse.json();
    
    const transcriptData = payload.transcript || (Array.isArray(payload) ? payload : []);
    const metadata = payload.metadata || {};
    
    // Extract metadata
    const title = metadata.title || `YouTube Video: ${videoId}`;
    const description = metadata.description || "";
    const author = metadata.author || "Unknown Channel";
    const keywords = metadata.keywords || [];

    console.log(`📝 Extracted Title: ${title}`);
    console.log(`📝 Extracted Description: ${description.substring(0, 100)}...`);
    console.log(`📝 Extracted Author: ${author}`);
    console.log(`📝 Extracted Keywords: ${keywords.length > 0 ? keywords.slice(0, 5).join(', ') + '...' : 'None'}`);

    // Process transcript
    let content = "";
    let duration = 0;

    if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
       console.warn(`[YouTube Extractor] No transcript tracks available. Falling back to metadata only.`);
       content = "No transcript available for this video due to region blocks or missing captions. Please rely strictly on the provided Title, Description, and Keywords metadata above to infer the content of the video.";
    } else {
      // The library returns an array of objects: { text: string, duration: number, offset: number }
      for (const item of transcriptData) {
          content += item.text + " ";
      }
      
      const lastItem = transcriptData[transcriptData.length - 1];
      // offset and duration are in ms
      duration = (lastItem.offset + lastItem.duration) / 1000;
    }

    console.log(`✅ Successfully extracted transcript: ${content.length} characters, ${Math.round(duration)}s duration`);

    // Prepend metadata to the final content to give the LLM structural context of the video before reading the transcript
    const metadataHeader = `
VIDEO METADATA
==============
Title: ${title}
Channel/Author: ${author}
Keywords/Tags: ${keywords.length > 0 ? keywords.join(', ') : 'None provided'}

VIDEO DESCRIPTION
=================
${description || 'No description provided.'}

VIDEO TRANSCRIPT
================
${content.trim()}
    `.trim();

    return {
      url: normalizedUrl,
      title,
      description,
      content: metadataHeader,
      metadata: {
        duration: Math.round(duration),
        videoId,
        author,
        keywords
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
