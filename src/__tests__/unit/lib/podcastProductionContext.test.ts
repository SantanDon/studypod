import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPodcastEvidenceContext, generatePodcastScript } from '@/lib/podcastGenerator';
import { indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';
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
