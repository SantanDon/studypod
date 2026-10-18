import { describe, expect, it } from 'vitest';
import { buildYouTubeCaptionUrl, recoverYouTubeCaptions } from '../services/youtubeUnderstandingService.js';

const segment = { text: 'Actual spoken lesson content', start: 0, duration: 3 };
const manual = { baseUrl: 'https://www.youtube.com/api/timedtext?v=one&fmt=srv3', languageCode: 'en' };
const automatic = { baseUrl: 'https://www.youtube.com/api/timedtext?v=two', languageCode: 'en', kind: 'asr' };
const parsers = {
  parseJson: text => JSON.parse(text),
  parseXml: text => text === '<transcript>actual</transcript>' ? [segment] : [],
};

describe('YouTube caption recovery', () => {
  it('replaces an existing format and removes it for the native XML fallback', () => {
    const json = new URL(buildYouTubeCaptionUrl(manual.baseUrl));
    expect(json.searchParams.getAll('fmt')).toEqual(['json3']);
    expect(json.searchParams.get('v')).toBe('one');
    expect(new URL(buildYouTubeCaptionUrl(manual.baseUrl, null)).searchParams.has('fmt')).toBe(false);
  });

  it('recovers XML after malformed JSON instead of abandoning a real caption track', async () => {
    const urls = [];
    const result = await recoverYouTubeCaptions([manual], {
      ...parsers,
      fetchText: async url => { urls.push(url); return '<transcript>actual</transcript>'; },
    });
    expect(result).toEqual({ transcript: [segment], track: manual });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]).searchParams.has('fmt')).toBe(false);
  });

  it('tries the next available track after both preferred-track formats are empty', async () => {
    const result = await recoverYouTubeCaptions([automatic, manual], {
      ...parsers,
      fetchText: async url => new URL(url).searchParams.get('v') === 'one' ? '' : JSON.stringify([segment]),
    });
    expect(result).toEqual({ transcript: [segment], track: automatic });
  });

  it('recovers a native format after a failed JSON request', async () => {
    const result = await recoverYouTubeCaptions([manual], {
      ...parsers,
      fetchText: async url => {
        if (new URL(url).searchParams.has('fmt')) throw new Error('upstream unavailable');
        return '<transcript>actual</transcript>';
      },
    });
    expect(result.transcript).toEqual([segment]);
  });

  it('bounds recovery and never substitutes metadata for missing speech', async () => {
    let requests = 0;
    const result = await recoverYouTubeCaptions([manual, automatic, { ...manual, baseUrl: 'https://www.youtube.com/api/timedtext?v=three' }], {
      ...parsers,
      fetchText: async () => { requests += 1; return ''; },
    });
    expect(requests).toBe(4);
    expect(result).toEqual({ transcript: [], track: null });
  });
});
