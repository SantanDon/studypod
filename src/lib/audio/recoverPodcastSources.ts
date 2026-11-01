import type { PodcastContextSource } from '@/lib/podcastSourceContext';

type WebSource = PodcastContextSource & { type?: string; url?: string | null };

/** Recover old web imports that flattened the entire article into one paragraph.
 * Refetch the original structure rather than inventing boundaries or cutting prose.
 */
export async function recoverPodcastSources<T extends WebSource>(
  sources: T[],
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  const recovered: T[] = [];
  for (const source of sources) {
    const content = (source.content || '').replace(/\r\n?/g, '\n');
    if (source.type !== 'website' || !source.url || content.length <= 4000 || /\n\s*\n/.test(content)) {
      recovered.push(source);
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(`/api/proxy/extract-web?url=${encodeURIComponent(source.url)}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Extraction failed');
      const data = await response.json();
      const fresh = typeof data.content === 'string' ? data.content.replace(/\r\n?/g, '\n').trim() : '';
      const paragraphs = fresh.split(/\n\s*\n/).map((text: string) => text.trim());
      if (!/\n\s*\n/.test(fresh) || !paragraphs.some((text: string) => text.length >= 50 && text.length <= 4000)) {
        throw new Error('No complete paragraphs recovered');
      }
      recovered.push({ ...source, content: fresh });
    } catch {
      throw new Error(`Could not recover paragraphs for "${source.title || 'this web source'}". Refresh the source or paste the original article with paragraph breaks, then retry audio.`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return recovered;
}
