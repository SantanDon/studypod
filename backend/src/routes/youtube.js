import express from 'express';
import { YoutubeTranscript } from 'youtube-transcript';

const router = express.Router();



/**
 * GET /youtube-transcript
 * Fetch YouTube transcript using youtube-transcript library
 */
router.get('/youtube-transcript', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const decodedUrl = decodeURIComponent(url);

    if (!decodedUrl.includes('youtube.com') && !decodedUrl.includes('youtu.be')) {
      return res.status(400).json({ error: 'Only YouTube URLs are allowed' });
    }

    console.log(`[YouTube Transcript] Fetching transcript for: ${decodedUrl}`);

    const transcript = await YoutubeTranscript.fetchTranscript(decodedUrl);

    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ 
        error: 'No transcript available for this video. It may not have captions enabled.' 
      });
    }

    console.log(`[YouTube Transcript] Successfully fetched ${transcript.length} transcript segments`);
    res.json(transcript);
  } catch (error) {
    console.error('[YouTube Transcript] Error:', error);
    
    let errorMessage = 'Failed to fetch transcript';
    let statusCode = 500;

    if (error.message?.includes('Transcript is disabled')) {
      errorMessage = 'Transcripts are disabled for this video';
      statusCode = 403;
    } else if (error.message?.includes('Video is unavailable')) {
      errorMessage = 'Video is unavailable or private';
      statusCode = 404;
    } else if (error.message?.includes('Could not find')) {
      errorMessage = 'Could not find transcript for this video';
      statusCode = 404;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(statusCode).json({ error: errorMessage });
  }
});

export default router;
