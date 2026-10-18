const tweetHosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

export function normalizeTweetUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !tweetHosts.has(url.hostname) || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d*)\/?$/);
    return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
  } catch { return null; }
}

export function validateTweetUrls(text: string) {
  const urls = new Map<string, string>();
  let invalidCount = 0;
  for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const url = normalizeTweetUrl(line);
    if (url) {
      const id = url.substring(url.lastIndexOf('/') + 1);
      if (!urls.has(id)) urls.set(id, url);
    }
    else invalidCount += 1;
  }
  return { urls: [...urls.values()], invalidCount };
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value);

/** Validate without executing JavaScript, and submit only entries the server can read. */
export function validateBookmarkArchive(content: string): { fileContent: string; count: number } {
  const wrapper = content.trim().match(/^window\.YTD\.(?:bookmarks?|tweets)\.part\d+\s*=\s*(\[[\s\S]*\])\s*;?$/);
  let data: unknown;
  try { data = JSON.parse(wrapper ? wrapper[1] : content); }
  catch { throw new Error('Cannot read this archive. Upload valid JSON or the original Twitter bookmark.js export.'); }
  if (!Array.isArray(data)) throw new Error('This archive format is unsupported. Upload a JSON array of tweet bookmarks or the original Twitter bookmark.js export.');

  const entries = new Map<string, { tweetId: string; user: { screen_name: string; name: string }; text: string }>();
  const add = (id: unknown, screenName: unknown, text: unknown, name: unknown) => {
    if (!validId(id)) throw new Error('An archive entry has an invalid tweet ID. Tweet IDs must be digit strings; use the original export.');
    if (entries.has(id)) return;
    const username = typeof screenName === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(screenName) ? screenName : 'unknown';
    entries.set(id, { tweetId: id, user: { screen_name: username, name: typeof name === 'string' ? name : 'Unknown' }, text: typeof text === 'string' ? text : '' });
  };
  for (const value of data) {
    const item = record(value);
    const timeline = record(item.bookmarkTimeline);
    if (Array.isArray(timeline.instructions)) {
      for (const instruction of timeline.instructions) {
        const values = record(instruction).entries;
        if (!Array.isArray(values)) continue;
        for (const entry of values) {
          const result = record(record(record(record(entry).content).itemContent).tweet_results).result;
          const rawResult = record(result);
          const tweet = record(rawResult.tweet || result);
          if (!tweet.rest_id) continue; // Timeline cursors are not bookmarks.
          const legacy = record(tweet.legacy);
          const user = record(record(record(record(tweet.core).user_results).result).legacy);
          if (!user.screen_name) throw new Error('A timeline tweet is missing its author. Use the original complete export.');
          add(tweet.rest_id, user.screen_name, legacy.full_text || legacy.text, user.name);
        }
      }
    } else {
      const tweet = record(item.tweet);
      const user = record(tweet.user || item.user);
      add(tweet.id_str || item.tweetId || item.id, user.screen_name, tweet.full_text || tweet.text || item.text, user.name);
    }
  }
  if (!entries.size) throw new Error('No tweet bookmarks found. Upload an export containing at least one tweet.');
  return { fileContent: JSON.stringify([...entries.values()]), count: entries.size };
}
