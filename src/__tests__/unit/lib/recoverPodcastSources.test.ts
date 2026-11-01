import { describe, expect, it, vi } from 'vitest';
import { recoverPodcastSources } from '@/lib/audio/recoverPodcastSources';
import { buildPodcastEvidenceContext } from '@/lib/podcastGenerator';
import { indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';

const paragraph = 'The proposed safety assessment remains conditional on further evaluation. It does not establish that the system is safe for deployment.';
const source = { id: 'legacy', type: 'website', title: 'Safety article', url: 'https://example.com/article', content: 'Legacy article '.repeat(400) };

describe('legacy web source recovery for audio', () => {
  it('recovers original paragraphs and passes both production evidence guards', async () => {
    const content = `# Safety article\n\n${paragraph}\n\n${paragraph}`;
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content }) });
    const recovered = await recoverPodcastSources([source], fetcher);
    expect(recovered[0]).toEqual({ ...source, content });
    expect(source.content).toBe('Legacy article '.repeat(400));
    expect(fetcher).toHaveBeenCalledWith('/api/proxy/extract-web?url=https%3A%2F%2Fexample.com%2Farticle', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }));
    const context = buildPodcastEvidenceContext(recovered);
    expect(context).toContain(paragraph);
    expect(indexPodcastEvidence(context).passages.length).toBeGreaterThan(0);
  });

  it('leaves structured websites, uploads and pasted text unchanged without fetching', async () => {
    const structured = { ...source, content: `${source.content}\n\n${paragraph}` };
    const upload = { ...source, type: 'pdf' };
    const pasted = { ...source, type: 'text', url: null };
    const fetcher = vi.fn();
    expect(await recoverPodcastSources([structured, upload, pasted], fetcher)).toEqual([structured, upload, pasted]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, json: async () => ({}) },
    { ok: true, json: async () => ({ content: source.content }) },
    { ok: true, json: async () => ({ content: '# Title\n\nLoading...' }) },
    { ok: true, json: async () => ({ content: null }) },
  ])('fails actionably without inventing or truncating passages when extraction is unusable', async (response) => {
    await expect(recoverPodcastSources([source], vi.fn().mockResolvedValue(response))).rejects.toThrow('Refresh the source or paste the original article with paragraph breaks');
    expect(source.content).toBe('Legacy article '.repeat(400));
  });
});
