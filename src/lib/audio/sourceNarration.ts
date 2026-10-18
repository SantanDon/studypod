import type { Source } from '@/types/domain/Source';

/** Never substitute a summary or an AI answer for the selected source's text. */
export function narrationSourceText(source: Pick<Source, 'content'>): string {
  const text = typeof source.content === 'string' ? source.content : '';
  if (text.trim().length < 2) throw new Error('This source has no extracted text to read aloud. Finish its import first.');
  if (text.length > 2_000_000) throw new Error('This source exceeds the read-aloud import limit. Import the original document in Audiobook Studio.');
  return text;
}

export function sourceMetadata(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export async function prepareSourceNarration(options: {
  source: Source;
  notebookId: string;
  apiBase: string;
  headers: Record<string, string>;
  fetcher?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const { source, notebookId, apiBase, headers, fetcher = fetch } = options;
  if (!notebookId || source.notebook_id !== notebookId) throw new Error('Choose a source from the current notebook.');
  const original = sourceMetadata(source.metadata);
  // Existing imported books retain their original extraction/manifest pipeline.
  if (typeof original.fileName === 'string' && Array.isArray(original.chapters) && original.chapters.length) return original;
  const text = narrationSourceText(source);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const previous = sourceMetadata(original.narration);
  if (previous.contentHash === contentHash && typeof previous.fileName === 'string' && Array.isArray(previous.chapters) && previous.chapters.length) return original;
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain;charset=utf-8' }), 'selected-source.txt');
  const response = await fetcher(`${apiBase}/audiobook/extract`, { method: 'POST', headers, body: form });
  const result = await response.json().catch((): null => null);
  if (!response.ok) throw new Error(result?.error || 'The read-aloud service could not prepare this source. No audio was generated.');
  if (!result || typeof result.fileName !== 'string' || !Array.isArray(result.chapters) || result.chapters.length === 0) {
    throw new Error('The read-aloud service did not return a usable chapter manifest.');
  }
  return {
    ...original,
    narration: {
      fileName: result.fileName,
      chapters: result.chapters,
      stats: result.stats,
      structure: result.structure,
      format: result.format,
      narrationDirection: result.narrationDirection,
      pronunciationCandidates: result.pronunciationCandidates || [],
      contentHash,
      coverage: 'all-available-source-text',
    },
  };
}
