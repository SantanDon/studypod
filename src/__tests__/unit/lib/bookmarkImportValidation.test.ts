import { describe, expect, it } from 'vitest';
import { normalizeTweetUrl, validateBookmarkArchive, validateTweetUrls } from '@/lib/bookmarkImportValidation';

describe('tweet seed validation', () => {
  it.each([
    'https://example.com/x.com/not-a-tweet', 'https://x.com.evil.test/user/status/123',
    'https://evilx.com/user/status/123', 'http://x.com/user/status/123',
    'https://x.com/user', 'https://x.com/user/status/nope', 'https://x.com/user/status/123/photos/1',
    'https://me:secret@x.com/user/status/123', 'https://x.com:444/user/status/123',
  ])('rejects misleading or unsupported link %s', value => expect(normalizeTweetUrl(value)).toBeNull());
  it('accepts supported hosts and deduplicates the same tweet across authors, hosts and tracking queries', () => {
    expect(validateTweetUrls('https://twitter.com/cedar/status/123?s=20\nhttps://www.x.com/cedar/status/123\nhttps://mobile.twitter.com/birch/status/124\nhttps://x.com/other/status/123\n')).toEqual({ urls: ['https://x.com/cedar/status/123', 'https://x.com/birch/status/124'], invalidCount: 0 });
  });
  it('reports invalid rows alongside valid rows instead of silently dropping them', () => {
    expect(validateTweetUrls('https://x.com/cedar/status/123\nhttps://example.com/x.com/status/124')).toEqual({ urls: ['https://x.com/cedar/status/123'], invalidCount: 1 });
  });
});

describe('bookmark archive validation', () => {
  it.each(['not JSON https://x.com/user/status/123', '[{}, {}]', '[]', '{"bookmarkTimeline":{"instructions":[]}}', '[{"id":123}]', '[{"tweet":{"id_str":"not-a-tweet"}}]'])('rejects invalid or empty archive %s', value => expect(() => validateBookmarkArchive(value)).toThrow());
  it('reads the official JS wrapper without executing it, preserves metadata and deduplicates IDs', () => {
    const archive = validateBookmarkArchive('window.YTD.bookmarks.part0 = [{"tweet":{"id_str":"123","full_text":"Cedar fact","user":{"screen_name":"cedar","name":"Cedar"}}},{"tweetId":"123"}];');
    expect(archive.count).toBe(1);
    // Keep the first complete entry when duplicates occur.
    expect(JSON.parse(archive.fileContent)[0].tweetId).toBe('123');
    expect(JSON.parse(archive.fileContent)[0].text).toBe('Cedar fact');
  });
  it('extracts actual timeline tweets and excludes cursor entries', () => {
    const tweet = { rest_id: '456', legacy: { full_text: 'Birch fact' }, core: { user_results: { result: { legacy: { screen_name: 'birch', name: 'Birch' } } } } };
    const archive = validateBookmarkArchive(JSON.stringify([{ bookmarkTimeline: { instructions: [{ entries: [{ content: { cursorType: 'Bottom' } }, { content: { itemContent: { tweet_results: { result: tweet } } } }] }] } }]));
    expect(archive.count).toBe(1);
    expect(JSON.parse(archive.fileContent)).toEqual([{ tweetId: '456', user: { screen_name: 'birch', name: 'Birch' }, text: 'Birch fact' }]);
  });
  it('rejects arbitrary JS assignments and does not salvage URLs from malformed JSON', () => {
    expect(() => validateBookmarkArchive('runCode(); window.YTD.bookmarks.part0 = [{"id":"123"}]')).toThrow('Cannot read');
  });
});
