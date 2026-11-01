import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPodcastEvidenceContext, generatePodcastScript } from '@/lib/podcastGenerator';
import { compilePodcastEvidence, indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';
import { chatCompletion } from '@/lib/ai/ollamaService';
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/config/ollamaModels', () => ({ getModelForTask: () => 'mock-model' }));
beforeEach(() => vi.mocked(chatCompletion).mockResolvedValue('{"passageIds":["p1"]}'));

describe('production source context to evidence generation', () => {
  it('generates from a 13k original upload using only whole paragraphs', async () => {
    const paragraphs = Array.from({length:100}, (_, i) => `Passage ${i}: The pilot remains planned; no measured outcomes have been reported. All limitations must remain attached to this passage.`);
    const context = buildPodcastEvidenceContext([{id:'upload', title:'Long document', content:paragraphs.join('\n\n')}]);
    expect(context.length).toBeLessThanOrEqual(12000);
    expect(context).not.toMatch(/excerpt gap|focused excerpt/);
    const evidence = indexPodcastEvidence(context);
    expect(evidence.excerpted).toBe(true);
    expect(evidence.passages.length).toBeGreaterThan(0);
    for (const passage of evidence.passages) expect(paragraphs).toContain(passage.text);
    const result = await generatePodcastScript(context, {userNotes:'INSTRUCTION_ONLY_SENTINEL'});
    expect(result.segments.some(segment => segment.text === paragraphs[0])).toBe(true);
    expect(result.segments.some(segment => /SOURCE:|COVERAGE:|INSTRUCTION_ONLY_SENTINEL/.test(segment.text))).toBe(false);
    expect(result.metadata?.sourceCoverage?.excerpted).toBe(true);
  });
  it('recovers complete evidence sentences from an oversized extracted paragraph for standard compilation', () => {
    const sentences = Array.from({ length: 220 }, (_, i) =>
      `Finding ${i} describes the observed cohort pattern; no causal conclusion is supported by this evidence.`,
    );
    const context = buildPodcastEvidenceContext([{ id: 'pdf', title: 'Extracted research', content: sentences.join(' ') }]);
    expect(context.length).toBeLessThanOrEqual(12_000);
    expect(context).toContain(sentences[0]);
    expect(context).toContain(sentences[40]);
    expect(context).toContain('complete source paragraphs or sentence-boundary passages');

    const evidence = indexPodcastEvidence(context);
    expect(evidence.excerpted).toBe(true);
    expect(evidence.passages.length).toBeLessThan(60);
    expect(evidence.passages[0].text).toContain(sentences[0]);
    expect(evidence.passages[0].text).toContain(sentences[1]);
    const compiled = compilePodcastEvidence(
      JSON.stringify({ passageIds: ['p1', 'p2'] }), evidence.passages, 'Alex', 'Sarah', false, 'standard', 1_200,
    );
    expect(compiled.segments.map(segment => segment.text).join(' ')).toContain(sentences[0]);
    expect(compiled.segments.map(segment => segment.text).join(' ')).toContain(sentences[1]);
  });
  it('lets deep context carry more complete source sentences than standard context', () => {
    const sentences = Array.from({ length: 320 }, (_, i) =>
      `Finding ${i} describes the observed cohort pattern; no causal conclusion is supported by this evidence.`,
    );
    const source = [{ id: 'long-pdf', title: 'Long extracted document', content: sentences.join(' ') }];
    const standard = buildPodcastEvidenceContext(source, { maxChars: 12_000 });
    const deep = buildPodcastEvidenceContext(source, { maxChars: 30_000 });
    const countWords = (context: string, budget: number) => indexPodcastEvidence(context, budget).passages
      .reduce((count, passage) => count + passage.text.split(/\s+/).filter(Boolean).length, 0);
    const standardWords = countWords(standard, 12_000);
    const deepWords = countWords(deep, 30_000);

    expect(standard.length).toBeLessThanOrEqual(12_000);
    expect(deep.length).toBeLessThanOrEqual(30_000);
    expect(deepWords).toBeGreaterThanOrEqual(standardWords * 1.5);
    expect(deep).toContain(sentences[250]);
    expect(standard).not.toContain(sentences[250]);
  });
  it('keeps deterministic deep-dive production within its spoken-word ceiling', async () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) =>
      `Section ${i + 1} records a measured observation; uncertainty remains attached. ` +
      'The source limits this interpretation to its stated evidence. '.repeat(70),
    );
    const context = buildPodcastEvidenceContext([{ id: 'deep-pdf', title: 'Deep source', content: paragraphs.join('\n\n') }], { maxChars: 30_000 });
    const indexed = indexPodcastEvidence(context, 30_000);
    expect(indexed.passages.length).toBeGreaterThanOrEqual(7);
    vi.mocked(chatCompletion).mockClear();

    const script = await generatePodcastScript(context, { type: 'deep-dive' });
    const spokenSourcePassages = script.segments
      .map(segment => segment.text)
      .filter(text => indexed.passages.some(passage => passage.text === text));
    expect(script.metadata?.type).toBe('deep-dive');
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
    expect(script.estimatedDuration).toBeLessThanOrEqual(30 * 60);
    expect(spokenSourcePassages.length).toBe(script.metadata?.evidencePassageIds?.length);
    expect(spokenSourcePassages.length).toBeGreaterThan(0);
    expect(spokenSourcePassages.every(text => indexed.passages.some(passage => passage.text === text))).toBe(true);
    // Deep Dive compiles its literal source selection deterministically; it no
    // longer asks the model for passage IDs or retries oversized selections.
    expect(vi.mocked(chatCompletion)).not.toHaveBeenCalled();

    const standardContext = buildPodcastEvidenceContext(
      [{ id: 'deep-pdf', title: 'Deep source', content: paragraphs.join('\n\n') }],
      { maxChars: 12_000 },
    );
    const standardIndexed = indexPodcastEvidence(standardContext, 12_000);
    vi.mocked(chatCompletion).mockClear();
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ passageIds: standardIndexed.passages.map(passage => passage.id) }));
    const standardScript = await generatePodcastScript(standardContext, { type: 'standard' });
    expect(script.estimatedDuration).toBeGreaterThanOrEqual(standardScript.estimatedDuration * 1.5);
  });
  it('filters standalone PDF front matter and retains complete inner sentences around page-edge fragments', () => {
    const prose = 'The opening argument is complete and remains useful. Writers on philosophy are 5';
    const continuedPage = '6 IDPH most apt to lose sight of the distinction here. A complete later argument follows in the text.';
    const nextPage = 'IDPH 7 but in great original thinkers. The argument is followed by this complete sentence.';
    const content = [
      'The Republic By Plato http://www.idph.net\n18 de maio de 2002',
      'Sumário INTRODUCTION AND ANALYSIS 5 BOOK I 177 BOOK II 211 BOOK III 239',
      '4 IDPH', prose, continuedPage, nextPage,
    ].join('\n\n');
    const context = buildPodcastEvidenceContext([{ id: 'republic', title: 'Republic PDF', content }]);
    const evidence = indexPodcastEvidence(context);
    const retained = evidence.passages.map(passage => passage.text);

    expect(context).not.toContain('Sumário');
    expect(context).not.toContain('http://www.idph.net');
    expect(retained).toContain('The opening argument is complete and remains useful.');
    expect(retained).toContain('A complete later argument follows in the text.');
    expect(retained).toContain('The argument is followed by this complete sentence.');
    expect(retained.join(' ')).not.toMatch(/writers on philosophy are 5|most apt to lose sight|but in great original/);
  });
  it('reserves space for each source and reports complete coverage accurately', () => {
    const first = 'First complete paragraph. Its limitations remain attached.';
    const second = 'Second complete paragraph. No results have been measured.';
    const context = buildPodcastEvidenceContext([{id:'a',title:'A',content:first},{id:'b',title:'B',content:second}], {maxChars:500});
    expect(context.length).toBeLessThanOrEqual(500);
    expect(indexPodcastEvidence(context)).toMatchObject({excerpted:false,passages:[{text:first},{text:second}]});
  });
  it('selects focused whole paragraphs without severing qualifiers', () => {
    const relevant = 'Photosynthesis is planned for study. No results have been measured.';
    const context = buildPodcastEvidenceContext([{content:'Unrelated background. '.repeat(30)+'\n\n'+relevant}], {maxChars:500,focus:'photosynthesis'});
    expect(indexPodcastEvidence(context).passages).toEqual([{id:'p1',text:relevant}]);
  });
  it('fails closed when a source has no complete paragraph that fits', () => {
    expect(() => buildPodcastEvidenceContext([{content:'word '.repeat(1000)}])).toThrow(/No complete source passages/);
  });
});
