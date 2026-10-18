import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({
  API_BASE_URL: '/api',
  ApiService: {
    recordYouTubeExtractionSuccess: vi.fn(),
  },
}));

import { extractVideoId, extractYoutubeTranscript } from '../youtubeExtractor';

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const unavailablePayload = {
  transcript: [],
  metadata: {
    title: 'Video metadata',
    transcriptStatus: 'metadata_only',
    transcriptProvider: 'server_metadata',
    transcriptQuality: { status: 'metadata_only', tier: 'unavailable', seekable: false },
    timingQuality: 'none',
    timestampedTranscript: false,
    transcriptSegments: [],
    providerCapabilities: { seekableCitations: false, timestampedSegments: false },
  },
  extractionWarning: 'No transcript was extracted.',
  structuredContent: '# Metadata only\nNo transcript available.',
};

describe('extractVideoId', () => {
  it.each([
    'https://www.youtube.com/watch?feature=shared&v=xmGY276gEFY&t=20',
    'https://youtu.be/xmGY276gEFY?si=shared',
    'https://m.youtube.com/shorts/xmGY276gEFY',
    'https://www.youtube.com/live/xmGY276gEFY',
    'https://www.youtube.com/embed/xmGY276gEFY',
    'https://music.youtube.com/watch?v=xmGY276gEFY',
  ])('accepts supported YouTube video link %s', url => {
    expect(extractVideoId(url)).toBe('xmGY276gEFY');
  });

  it.each([
    'https://youtube.com.evil.test/watch?v=xmGY276gEFY',
    'https://evil.test/youtube.com/watch?v=xmGY276gEFY',
    'https://www.youtube.com/watch?v=xmGY276gEFYextra',
    'javascript://youtube.com/watch?v=xmGY276gEFY',
    'https://www.youtube.com/playlist?list=xmGY276gEFY',
  ])('rejects non-video and lookalike links %s', url => {
    expect(extractVideoId(url)).toBeNull();
  });
});

describe('extractYoutubeTranscript', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries a metadata-only server response before using the Edge fallback', async () => {
    const metadataOnlyPayload = {
      transcript: [],
      metadata: {
        title: 'Cold YouTube response',
        author: 'Test Channel',
        transcriptStatus: 'metadata_only',
        extractedBy: 'innertube_mweb',
      },
      structuredContent: '# Cold YouTube response\n\n> No transcript is available.',
      extractionWarning: 'No transcript was extracted.',
    };
    const recoveredTranscript = [
      { text: 'Lint rules remain useful.', offset: 0, duration: 4_000, timingSource: 'provider' },
      { text: 'Tests and environment automation scale agent work.', offset: 4_000, duration: 5_000, timingSource: 'provider' },
    ];
    const recoveredPayload = {
      transcript: recoveredTranscript,
      metadata: {
        title: 'Recovered YouTube transcript',
        author: 'Test Channel',
        transcriptStatus: 'full',
        transcriptLineCount: recoveredTranscript.length,
        extractedBy: 'innertube_web_direct',
        transcriptProvider: 'innertube_web_direct',
        transcriptLanguage: 'en',
        transcriptSegments: recoveredTranscript,
        providerCapabilities: {
          seekableCitations: true,
          timestampedSegments: true,
          metadata: true,
          qualityAssessment: true,
          languageSelection: true,
        },
      },
      structuredContent: '# Recovered YouTube transcript\n\n## [0:00]\nLint rules remain useful. Tests and environment automation scale agent work.',
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadataOnlyPayload), {
        status: 206,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(recoveredPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://www.youtube.com/watch?v=xmGY276gEFY');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/youtube/youtube-transcript'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/youtube-edge'))).toBe(false);
    expect(result.title).toBe('Recovered YouTube transcript');
    expect(result.content).toBe(recoveredPayload.structuredContent);
    expect(result.metadata.transcriptStatus).toBe('full');
    expect(result.metadata.transcriptLineCount).toBe(2);
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(true);
  });

  it('replaces unavailable server evidence with the recovered Edge transcript', async () => {
    const transcript = [
      { text: 'The source explains the scientific method.', offset: 0, duration: 5000 },
      { text: 'A hypothesis should be tested against evidence.', offset: 5000, duration: 6000 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unavailablePayload, 206))
      .mockResolvedValueOnce(jsonResponse(unavailablePayload, 206))
      .mockResolvedValueOnce(jsonResponse({ title: 'Recovered captions', transcript, extractedBy: 'edge_web', language: 'fr', transcriptStatus: 'full' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://youtu.be/xmGY276gEFY', undefined, 'fr');

    expect(fetchMock.mock.calls[2][0]).toContain('&language=fr');
    expect(result.content).toContain('A hypothesis should be tested against evidence.');
    expect(result.content).not.toContain('Metadata only');
    expect(result.metadata.transcriptStatus).toBe('full');
    expect(result.metadata.transcriptProvider).toBe('edge_web');
    expect(result.metadata.transcriptLanguage).toBe('fr');
    expect(result.metadata.transcriptSegments).toHaveLength(2);
    expect(result.metadata.transcriptQuality).toBeUndefined();
    expect(result.metadata.timingQuality).toBe('provider');
    expect(result.metadata.timestampedTranscript).toBe(true);
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(true);
    expect(result.metadata.extractionWarning).toBe('');
  });

  it('continues to authenticated Edge recovery when the initial server request disconnects', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({
        transcript: [{ text: 'Captions recovered after the server disconnected.', offset: 0, duration: 4000 }],
        extractedBy: 'edge_web',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://youtu.be/xmGY276gEFY', 'test-access-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/youtube-edge?videoId=xmGY276gEFY&language=en',
      { headers: { Authorization: 'Bearer test-access-token' }, credentials: 'include' },
    ]);
    expect(result.content).toContain('Captions recovered after the server disconnected.');
    expect(result.metadata.transcriptStatus).toBe('full');
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(true);
    expect(result.metadata.extractionWarning).toBe('');
  });

  it('continues to Edge recovery when the server retry disconnects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unavailablePayload, 206))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ transcript: [{ text: 'Recovered text with no duration.', offset: 0 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://youtu.be/xmGY276gEFY');

    expect(result.content).toContain('Recovered text with no duration.');
    expect(result.metadata.transcriptStatus).toBe('full');
    expect(result.metadata.duration).toBe(0);
  });

  it('never marks metadata-only content ready or seekable even with stale server flags', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...unavailablePayload, metadata: {
        ...unavailablePayload.metadata,
        transcriptStatus: 'full',
        timestampedTranscript: true,
        providerCapabilities: { seekableCitations: true, timestampedSegments: true },
      } }))
      .mockResolvedValueOnce(jsonResponse({ transcript: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://youtu.be/xmGY276gEFY');

    expect(result.metadata.transcriptStatus).toBe('metadata_only');
    expect(result.metadata.transcriptSegments).toEqual([]);
    expect(result.metadata.timestampedTranscript).toBe(false);
    expect(result.metadata.timingQuality).toBe('none');
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(false);
    expect(result.metadata.providerCapabilities?.timestampedSegments).toBe(false);
  });

  it('preserves untimed recovered text without claiming seekable timestamps', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unavailablePayload))
      .mockResolvedValueOnce(jsonResponse({ transcript: [{ text: 'Recovered text without timing.' }], transcriptStatus: 'partial' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://youtu.be/xmGY276gEFY');

    expect(result.content).toContain('Recovered text without timing.');
    expect(result.metadata.transcriptStatus).toBe('partial');
    expect(result.metadata.timingQuality).toBe('inferred');
    expect(result.metadata.timestampedTranscript).toBe(false);
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(false);
    expect(result.metadata.providerCapabilities?.timestampedSegments).toBe(false);
  });
});
