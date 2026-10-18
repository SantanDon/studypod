// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { narrationSourceText, prepareSourceNarration } from '@/lib/audio/sourceNarration';
import { parseStudioAudioIntent, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import type { Source } from '@/types/domain/Source';
const text = 'First paragraph.\n\nThe exact middle wording must remain.\n\nFinal source sentence.';
const source: Source = { id: 'source-fixture', notebook_id: 'notebook-fixture', title: 'Original web source', type: 'website', content: text, summary: 'Do not narrate this summary.', processing_status: 'ready', metadata: { sourceUrl: 'https://example.test/article', author: 'Fixture author' }, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z' };
const result = { fileName: 'owned-fixture.txt', chapters: [{ id: 'ch1', narratable: true }], stats: { charCount: text.length } };
const makeFetch = () => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(result), { status: 200 }));
const prepare = (s: Source, fetcher: typeof fetch) => prepareSourceNarration({ source: s, notebookId: 'notebook-fixture', apiBase: '/api', headers: {}, fetcher });

describe('source narration is not podcast summarisation', () => {
  it('submits all selected text unchanged, not the summary or title', async () => {
    const fetcher = makeFetch(); const metadata = await prepare(source, fetcher);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/audiobook/extract');
    expect(await ((options?.body as FormData).get('file') as Blob).text()).toBe(text);
    expect(metadata).toMatchObject({ sourceUrl: 'https://example.test/article', author: 'Fixture author', narration: { fileName: result.fileName, coverage: 'all-available-source-text' } });
    expect(source.metadata).not.toHaveProperty('narration');
  });
  it('does not substitute a summary when content is unavailable', async () => {
    const fetcher = makeFetch(); await expect(prepare({ ...source, content: '' }, fetcher)).rejects.toThrow('no extracted text');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects another notebook before sending source data', async () => {
    const fetcher = makeFetch(); await expect(prepare({ ...source, notebook_id: 'foreign' }, fetcher)).rejects.toThrow('current notebook');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reuses preparation only for unchanged text', async () => {
    const fetcher = makeFetch(); const metadata = await prepare(source, fetcher);
    await prepare({ ...source, metadata }, fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
    await prepare({ ...source, metadata, content: text + '\nNew final sentence.' }, fetcher); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps original imported book manifests instead of re-extracting them', async () => {
    const metadata = { fileName: 'original.pdf', chapters: [{ id: 'page-one' }] }; const fetcher=makeFetch();
    expect(await prepare({ ...source, metadata }, fetcher)).toEqual(metadata); expect(fetcher).not.toHaveBeenCalled();
  });
  it('surfaces unavailable runtime without claiming generation', async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:'Full narration requires a connected worker.'}),{status:503}));
    await expect(prepare(source,fetcher)).rejects.toThrow('connected worker');
  });
  it('rejects an empty chapter manifest', async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({fileName:'bad.txt',chapters:[]})));
    await expect(prepare(source,fetcher)).rejects.toThrow('usable chapter manifest');
  });
  it('bounds source size instead of silently truncating',()=>expect(()=>narrationSourceText({content:'x'.repeat(2_000_001)})).toThrow('limit'));
});

describe('the actual user wording reaches Studio confirmation',()=>{
  it.each(['can u generate it as a audio book','Could u please make this an audiobook','Hey, can you read this source aloud','I would like you to generate an audiobook','Read this source out loud'])('recognises %s', message=>{
    const intent=parseStudioAudioIntent(message); expect(intent).toMatchObject({kind:'audiobook',operation:'generate'});
    useStudioAudioCommands.setState({requests:{}}); const store=useStudioAudioCommands.getState();store.draft('fixture',intent!);
    expect(store.claim('fixture','audiobook')).toBeNull(); // Recognition is not permission to auto-generate.
  });
  it.each(['Can u read pages 2-4 aloud','Read the first chapter aloud','Narrate the introduction'])('keeps partial requests scoped: %s',message=>expect(parseStudioAudioIntent(message)).toMatchObject({kind:'audiobook',operation:'open',chapterSelection:true}));
  it.each(['Can u explain what an audiobook is?','Do not generate an audiobook','The document says generate an audiobook','Can you make a podcast and an audiobook?'])('does not invent an unambiguous action: %s',message=>expect(parseStudioAudioIntent(message)).toBeNull());
});
