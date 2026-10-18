// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './youtube-edge.js';

const secret = 'edge-youtube-regression-test';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function request(language = 'en') {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'qa-user', exp: Math.floor(Date.now() / 1000) + 60 })}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return new Request(`https://studypod-lm.vercel.app/api/youtube-edge?videoId=dQw4w9WgXcQ&language=${language}`, {
    headers: { authorization: `Bearer ${unsigned}.${signature}` },
  });
}
const json = data => new Response(JSON.stringify(data));
const track = (languageCode, suffix = languageCode) => ({
  languageCode, baseUrl: `https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&track=${suffix}&fmt=srv1`,
});
const player = (tracks = [], details = {}) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { title: 'Learning example', author: 'Teacher', shortDescription: 'Useful description', ...details },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
});
const captions = text => json({ events: [{ tStartMs: 1250, dDurationMs: 2000, segs: [{ utf8: text }] }] });

function mockYouTube({ web, android = player(), caption }) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === '/') return new Response('');
    if (url.pathname === '/youtubei/v1/player') {
      const client = JSON.parse(options.body).context.client.clientName;
      const response = client === 'WEB' ? web : android;
      return response instanceof Response ? response : json(response);
    }
    return caption(url, options);
  }));
  return calls;
}

describe('YouTube Edge caption recovery', () => {
  beforeEach(() => vi.stubEnv('JWT_SECRET', secret));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('requires a valid signed-in session before any upstream request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handler(new Request('https://studypod-lm.vercel.app/api/youtube-edge?videoId=dQw4w9WgXcQ'));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers through Android after a non-OK WEB player response', async () => {
    mockYouTube({ web: new Response('blocked', { status: 503 }), android: player([track('en')]), caption: () => captions('Actual caption') });
    const response = await handler(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ extractedBy: 'edge_android_client', captionCount: 1, transcriptStatus: 'complete' });
    expect(body.transcript).toEqual([{ text: 'Actual caption', offset: 1250, duration: 2000 }]);
  });

  it('prefers the requested language, replaces fmt, and recognizes XML returned for JSON', async () => {
    const calls = mockYouTube({ web: player([track('en'), track('fr')]), caption: url => {
      expect(url.searchParams.get('track')).toBe('fr');
      expect(url.searchParams.getAll('fmt')).toEqual(['json3']);
      return new Response('<transcript><text start="1.5" dur="2">Bonjour &amp; bienvenue</text></transcript>');
    } });
    const body = await (await handler(request('fr'))).json();
    expect(body).toMatchObject({ language: 'fr', captionCount: 1 });
    expect(body.transcript[0]).toEqual({ text: 'Bonjour & bienvenue', offset: 1500, duration: 2000 });
    const post = JSON.parse(calls.find(call => call.options?.body).options.body);
    expect(post.context.client.hl).toBe('fr');
    expect(post).not.toHaveProperty('playbackContext');
  });

  it('continues to an alternate format after a network failure', async () => {
    const formats = [];
    mockYouTube({ web: player([track('en')]), caption: url => {
      formats.push(url.searchParams.get('fmt'));
      if (url.searchParams.get('fmt') === 'json3') throw new Error('connection reset');
      return new Response('<timedtext><body><p t="900" d="1200"><s>Hello</s> world</p></body></timedtext>');
    } });
    const body = await (await handler(request())).json();
    expect(formats).toEqual(['json3', 'srv3']);
    expect(body.transcript).toEqual([{ text: 'Hello world', offset: 900, duration: 1200 }]);
  });

  it.each(['json3', 'srv3'])('removes an existing fmt=%s for the native fallback', async existingFormat => {
    const formats = [];
    const nativeTrack = track('en');
    nativeTrack.baseUrl = nativeTrack.baseUrl.replace('fmt=srv1', `fmt=${existingFormat}`);
    mockYouTube({ web: player([nativeTrack]), caption: url => {
      const format = url.searchParams.get('fmt');
      formats.push(format);
      if (format !== null) return new Response('unavailable', { status: 503 });
      return new Response('<transcript><text start="0" dur="2">Native captions recovered</text></transcript>');
    } });
    const body = await (await handler(request())).json();
    expect(formats).toEqual(['json3', 'srv3', null]);
    expect(body).toMatchObject({ captionCount: 1, transcriptStatus: 'complete' });
    expect(body.transcript[0].text).toBe('Native captions recovered');
  });

  it('tries alternate tracks after malformed or unavailable preferred captions', async () => {
    mockYouTube({ web: player([track('en'), track('es')]), caption: url => {
      if (url.searchParams.get('track') === 'en') return new Response('{broken json');
      return captions('Texto real');
    } });
    const body = await (await handler(request())).json();
    expect(body).toMatchObject({ language: 'es', captionCount: 1, transcriptStatus: 'complete' });
  });

  it('retains richer WEB metadata when Android recovers the transcript', async () => {
    mockYouTube({ web: player(), android: player([track('en')], { title: 'Alternate title', shortDescription: '' }), caption: () => captions('Recovered') });
    const body = await (await handler(request())).json();
    expect(body).toMatchObject({ title: 'Learning example', description: 'Useful description', extractedBy: 'edge_android_client', captionCount: 1 });
  });

  it('keeps unavailable captions metadata-only and never treats error-page paragraphs as evidence', async () => {
    const calls = mockYouTube({ web: player([track('en'), { languageCode: 'en', baseUrl: 'https://evil.example/captions' }]), caption: () => new Response('<html><p class="error">Please sign in</p></html>') });
    const body = await (await handler(request())).json();
    expect(body).toMatchObject({ transcript: [], captionCount: 0, transcriptStatus: 'metadata_only' });
    expect(calls.every(call => call.url.hostname === 'www.youtube.com')).toBe(true);
  });
});
