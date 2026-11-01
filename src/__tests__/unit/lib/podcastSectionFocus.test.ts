import {beforeEach, describe, expect, it, vi} from 'vitest';
import {chatCompletion} from '@/lib/ai/ollamaService';
import {buildPodcastEvidenceContext, generatePodcastScript} from '@/lib/podcastGenerator';
import {indexPodcastEvidence, selectUniquePodcastSection} from '@/lib/audio/podcastEvidencePlan';

vi.mock('@/lib/ai/ollamaService', () => ({chatCompletion: vi.fn()}));
vi.mock('@/config/ollamaModels', () => ({getModelForTask: () => 'mock-model'}));

const note = 'New original cover art included with this eBook is granted to the public domain.';
const introduction = 'Plato considers justice and the education of guardians. '.repeat(80).trim();
const ebook = `Introduction and Analysis\n\n${Array(5).fill(introduction).join('\n\n')}\n\n`
  + `--- Transcriber’s Notes ---\n\nTranscriber’s Notes\n\n${note}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatCompletion).mockResolvedValue('{"passageIds":["p1"]}');
});

describe('explicit podcast section focus', () => {
  it('selects a uniquely named late section before filling the context budget', () => {
    const context = buildPodcastEvidenceContext([{id: 'ebook', title: 'Republic', content: ebook}],
      {focus: "Focus on Transcriber's Notes.", maxChars: 12000});
    expect(context).toContain('[SECTION: Transcriber’s Notes]');
    expect(context).toContain(note);
    expect(context).not.toContain('education of guardians');
    expect(context).not.toContain('--- Transcriber');
    expect(context).toContain('COVERAGE: partial;');
    expect(context.length).toBeLessThanOrEqual(12000);
    expect(indexPodcastEvidence(context).passages).toEqual([
      {id: 'p1', text: note, sectionHeading: 'Transcriber’s Notes', sourceId: 'ebook'},
    ]);
  });

  it('does not fill a requested ebook section with an unrelated PDF source', () => {
    const context = buildPodcastEvidenceContext([
      {id: 'pdf', title: 'Republic PDF', content: introduction},
      {id: 'ebook', title: 'Republic ebook', content: ebook},
    ], {focus: 'Transcriber’s Notes'});
    expect(context).toContain('SOURCE: Republic ebook');
    expect(context).not.toContain('SOURCE: Republic PDF');
    expect(context).not.toContain('education of guardians');
  });

  it('attributes focused spoken evidence only to the ebook, excluding the unused PDF', async () => {
    const context = buildPodcastEvidenceContext([
      {id: 'pdf', title: 'Republic PDF', content: introduction},
      {id: 'ebook', title: 'Republic ebook', content: ebook},
    ], {focus: 'Transcriber’s Notes'});
    const result = await generatePodcastScript(context, {type: 'brief', userNotes: 'Transcriber’s Notes'});
    expect(result.metadata?.evidenceSourceIds).toEqual(['ebook']);
    expect(result.segments.map(segment => segment.text)).toContain(note);
    expect(result.segments.map(segment => segment.text).join(' ')).not.toContain('SOURCE_ID');
  });

  it.each([
    [['p2'], ['second']],
    [['p1', 'p2'], ['first', 'second']],
  ])('attributes only selected passage origins, preserving legitimate multiple sources (%j)', async (passageIds, expectedIds) => {
    // Identical titles and prose must not merge distinct source origins.
    const context = buildPodcastEvidenceContext([
      {id: 'first', title: 'Shared title', content: 'The same complete evidence appears in this source.'},
      {id: 'second', title: 'Shared title', content: 'The same complete evidence appears in this source.'},
    ]);
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({passageIds}));
    const result = await generatePodcastScript(context, {type: 'brief'});
    expect(result.metadata?.evidenceSourceIds).toEqual(expectedIds);
    expect(result.segments.map(segment => segment.text).join(' ')).not.toContain('SOURCE_ID');
  });

  it('does not turn malformed origin metadata into spoken source prose', () => {
    const result = indexPodcastEvidence('SOURCE: Fixture\nSOURCE_ID: not-json\nCOVERAGE: partial;\n\nA complete source sentence.');
    expect(result.passages).toEqual([{id: 'p1', text: 'A complete source sentence.'}]);
  });

  it('stops at the next explicit section without rewriting source wording', () => {
    const source = `Chapter 1\n\nFirst chapter source words.\n\nChapter 2\n\nSecond chapter source words.`;
    expect(selectUniquePodcastSection(source, 'Please read Chapter 1.')).toEqual({
      heading: 'Chapter 1', content: '[SECTION: Chapter 1]\n\nFirst chapter source words.',
    });
  });

  it('does not assert exact section retrieval for ambiguous headings or topic notes', () => {
    expect(selectUniquePodcastSection('Chapter 1\n\nFirst words.\n\nChapter 1\n\nOther words.', 'Chapter 1'))
      .toBeUndefined();
    expect(selectUniquePodcastSection(ebook, 'Please discuss education quality.')).toBeUndefined();
  });

  it('constrains brief generation to the selected literal section, even on raw over-budget input', async () => {
    const script = await generatePodcastScript(ebook, {type: 'brief', userNotes: "Transcriber's Notes"});
    expect(script.segments.map(segment => segment.text)).toContain(note);
    expect(script.segments.map(segment => segment.text).join(' ')).not.toContain('education of guardians');
    const prompt = vi.mocked(chatCompletion).mock.calls[0][0].messages[1].content;
    expect(prompt).toContain(note);
    expect(prompt).not.toContain('education of guardians');
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
  });
});
