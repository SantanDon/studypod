import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '@/lib/ai/ollamaService';
import { buildPodcastEvidenceContext, generatePodcastScript } from '@/lib/podcastGenerator';
import { compilePodcastEvidence, indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';

vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/config/ollamaModels', () => ({ getModelForTask: () => 'mock-model' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatCompletion).mockResolvedValue('{"passageIds":["p1"]}');
});

describe('guided podcast depth', () => {
  it('admits more complete source passages at the deep-dive evidence budget', () => {
    const source = Array.from({ length: 10 }, (_, index) =>
      `PASSAGE_${index + 1} ` + 'Original wording with its stated qualification. '.repeat(55),
    ).join('\n\n');
    const standard = buildPodcastEvidenceContext([{ id: 'book', title: 'Large book', content: source }], { maxChars: 12_000 });
    const deepDive = buildPodcastEvidenceContext([{ id: 'book', title: 'Large book', content: source }], { maxChars: 30_000 });

    expect(standard).not.toContain('PASSAGE_8');
    expect(deepDive).toContain('PASSAGE_8');
    expect(deepDive.length).toBeGreaterThan(standard.length);
    expect(deepDive.length).toBeLessThanOrEqual(30_000);
  });

  it('permits a deep-dive plan when selected complete passages support 20-30 minutes', async () => {
    const passages = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index + 1}`,
      text: `Passage ${index + 1} reports qualified evidence. ` + 'The study records observations with stated limits. '.repeat(63),
    }));
    const ids = passages.map(({ id }) => id);
    const compiled = compilePodcastEvidence(JSON.stringify({ passageIds: ids }), passages, 'Alex', 'Sarah', false, 'deep-dive', 4500);
    expect(compiled.words).toBeGreaterThanOrEqual(3000);
    expect(compiled.words).toBeLessThanOrEqual(4500);
    expect(compiled.evidencePassageIds).toEqual(ids);
  });

  it('reselects fewer whole passages once when a provider exceeds the brief spoken-word ceiling', async () => {
    const first = 'Finding one remains qualified. '.repeat(75).trim();
    const second = 'Finding two remains qualified. '.repeat(75).trim();
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce('{"passageIds":["p1","p2"]}')
      .mockResolvedValueOnce('{"passageIds":["p1"]}');

    const script = await generatePodcastScript(`${first}\n\n${second}`, { type: 'brief', format: 'solo' });

    expect(vi.mocked(chatCompletion)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chatCompletion).mock.calls[1][0].messages[1].content).toContain('p1: 300 words');
    expect(vi.mocked(chatCompletion).mock.calls[1][0].messages[1].content).toContain('Return a smaller set of complete passage IDs');
    expect(script.segments.map(({ text }) => text).filter(text => text === first)).toEqual([first]);
    expect(script.segments.some(({ text }) => text === second)).toBe(false);
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
  });

  it('falls back to the most substantive fitting whole passages when both provider selections exceed the brief ceiling', async () => {
    const first = 'First '.repeat(300).trim();
    const second = 'Second '.repeat(250).trim();
    const third = 'Third '.repeat(40).trim();
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce('{"passageIds":["p1","p2"]}')
      .mockResolvedValueOnce('{"passageIds":["p1","p2"]}');

    const script = await generatePodcastScript(`${first}\n\n${second}\n\n${third}`, { type: 'brief', format: 'solo' });

    expect(vi.mocked(chatCompletion)).toHaveBeenCalledTimes(2);
    expect(script.metadata?.evidencePassageIds).toEqual(['p1']);
    expect(script.segments.map(({text}) => text).filter(text => text === first)).toEqual([first]);
    expect(script.segments.some(({text}) => text === second || text === third)).toBe(false);
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
    expect(script.segments.reduce((count, {text}) => count + text.split(/\s+/).filter(Boolean).length, 0)).toBeLessThanOrEqual(350);
  });

  it('keeps failing when no complete passage and framing can fit after both provider selections', async () => {
    const onlyPassage = 'word '.repeat(400).trim();
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce('{"passageIds":["p1"]}')
      .mockResolvedValueOnce('{"passageIds":["p1"]}');

    await expect(generatePodcastScript(onlyPassage, { type: 'brief', format: 'solo' }))
      .rejects.toThrow(/selected complete passages and framing total/);
    expect(vi.mocked(chatCompletion)).toHaveBeenCalledTimes(2);
  });

  it('omits an explicit contents list from deterministic fallback while retaining whole narrative passages', async () => {
    const contents = 'Sumário\nINTRODUCTION AND ANALYSIS 5\nBOOK I 9\nBOOK II 15\nCHAPTER 1 20';
    const main = 'Main finding '.repeat(280).trim();
    const qualification = 'Qualification '.repeat(200).trim();
    vi.mocked(chatCompletion)
      .mockResolvedValueOnce('{"passageIds":["p2","p3"]}')
      .mockResolvedValueOnce('{"passageIds":["p2","p3"]}');

    const script = await generatePodcastScript(`${contents}\n\n${main}\n\n${qualification}`, { type: 'brief', format: 'solo' });
    const spoken = script.segments.map(({text}) => text);

    expect(script.metadata?.evidencePassageIds).toEqual(['p3']);
    expect(spoken).toContain(qualification);
    expect(spoken).not.toContain(contents);
    expect(spoken).not.toContain(main);
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
    expect(script.segments.reduce((count, {text}) => count + text.split(/\s+/).filter(Boolean).length, 0)).toBeLessThanOrEqual(350);
  });

  it('filters a clean contents paragraph from provider selections and retains whole narrative paragraphs', () => {
    const contents = 'Sumário\nINTRODUCTION 5\nBOOK I 9\nCHAPTER 1 20';
    const narrative = 'The measured result applies only to the reported sample.';
    const passages = [
      {id: 'p1', text: contents},
      {id: 'p2', text: narrative},
    ];

    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1', 'p2']}), passages, 'Alex', 'Sarah', false, 'brief', 350,
    );

    expect(compiled.evidencePassageIds).toEqual(['p2']);
    expect(compiled.segments.map(({text}) => text)).toContain(narrative);
    expect(compiled.segments.map(({text}) => text)).not.toContain(contents);
  });

  it('filters a flattened uppercase contents line but keeps a sentence-like summary with numbers', () => {
    const flattenedContents = 'Sumário INTRODUCTION AND ANALYSIS 5 BOOK I 9 BOOK II 15 CHAPTER 1 20';
    const proseSummary = 'Sumário: The introduction reports 5 findings, and Book I discusses 9 examples across 15 pages.';
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1', 'p2']}),
      [{id: 'p1', text: flattenedContents}, {id: 'p2', text: proseSummary}],
      'Alex', 'Sarah', false, 'brief', 350,
    );

    expect(compiled.evidencePassageIds).toEqual(['p2']);
    expect(compiled.segments.map(({text}) => text)).toContain(proseSummary);
    expect(compiled.segments.map(({text}) => text)).not.toContain(flattenedContents);
  });

  it('fails honestly when a provider selects only a contents passage', () => {
    const contents = 'Sumário\nINTRODUCTION 5\nBOOK I 9\nCHAPTER 1 20';
    expect(() => compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1']}), [{id: 'p1', text: contents}], 'Alex', 'Sarah', false, 'brief', 350,
    )).toThrow(/only navigation or PDF front matter/);
  });

  it('keeps inseparable contents and prose together instead of clipping substantive text', () => {
    const mixed = 'Sumário\nINTRODUCTION 5\nBOOK I 9\nCHAPTER 1 20\nThe measured result applies only to the reported sample.';
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1']}), [{id: 'p1', text: mixed}], 'Alex', 'Sarah', false, 'brief', 350,
    );
    expect(compiled.segments.map(({text}) => text)).toContain(mixed);
  });

  it('excludes page-number-only PDF headers and URL/date source-card metadata', () => {
    const pageHeader = '2 IDPH';
    const sourceCard = 'The Republic By Plato\nhttp://www.idph.net\n18 de maio de 2002\n2 IDPH\n4 IDPH http://www.idph.net';
    const prose = 'The report describes a measured result and its stated limitation.';
    const passages = [
      {id: 'p1', text: pageHeader},
      {id: 'p2', text: sourceCard},
      {id: 'p3', text: prose},
    ];
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1', 'p2', 'p3']}), passages, 'Alex', 'Sarah', false, 'brief', 350,
    );
    expect(compiled.evidencePassageIds).toEqual(['p3']);
    expect(compiled.segments.map(({text}) => text)).toContain(prose);
  });

  it('keeps substantive passages from a realistic extracted source card and contents page', () => {
    const extracted = [
      'The Republic By Plato http://www.idph.net 18 de maio de 2002',
      'Sumário\nINTRODUCTION AND ANALYSIS 5\nBOOK I 9\nBOOK II 15\nCHAPTER 1 20',
      'The division into books follows the argument. Justice is examined through a sequence of questions.',
      'Earlier sentence. The next extraction ends with an incomplete clause and page number 5',
    ].join('\n\n');
    const evidence = indexPodcastEvidence(extracted);
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: evidence.passages.map(({id}) => id)}),
      evidence.passages,
      'Alex', 'Sarah', false, 'standard', 500,
    );

    expect(evidence.passages.map(({text}) => text)).toEqual([
      'Sumário\nINTRODUCTION AND ANALYSIS 5\nBOOK I 9\nBOOK II 15\nCHAPTER 1 20',
      'The division into books follows the argument. Justice is examined through a sequence of questions.',
    ]);
    expect(compiled.evidencePassageIds).toEqual(['p2']);
    expect(compiled.segments.map(({text}) => text)).toContain(evidence.passages[1].text);
    expect(compiled.segments.map(({text}) => text)).not.toContain(evidence.passages[0].text);
    expect(evidence.excerpted).toBe(true);
  });

  it('strips exact inline IDPH page markers while preserving adjacent source prose', () => {
    const evidence = indexPodcastEvidence(
      '[SECTION: INTRODUCTION]\nThe Republic asks how justice should be understood.\n\nIDPH 7 Begins the next substantive explanation.\n\nThe argument continues with a qualification. 8 IDPH',
    );
    expect(evidence.passages.map(({text}) => text)).toEqual([
      'The Republic asks how justice should be understood.',
      'Begins the next substantive explanation.',
      'The argument continues with a qualification.',
    ]);
    expect(evidence.passages[1].sectionHeading).toBe('INTRODUCTION');
  });

  it('omits a lowercase continuation immediately after an IDPH page-start marker', () => {
    const evidence = indexPodcastEvidence(
      '[SECTION: INTRODUCTION]\nThe Republic asks how justice should be understood.\n\nIDPH 7 but in great original writers like Berkeley, the idea develops further.',
    );

    expect(evidence.passages.map(({text}) => text)).toEqual([
      'The Republic asks how justice should be understood.',
    ]);
  });

  it('fails closed on a bare terminal number after an incomplete paragraph', () => {
    const truncated = 'Earlier sentence. The greatest of all logical truths, and the one of which writers on philosophy are5';
    const captured = 'Earlier sentence. The greatest of all logical truths, and the one of which writers on philosophy are 5';
    const complete = 'The next paragraph reports that the measured value was 5.';
    const evidence = indexPodcastEvidence(`${truncated}\n\n${captured}\n\n${complete}`);

    expect(evidence.passages.map(({text}) => text)).toEqual([complete]);
    expect(evidence.excerpted).toBe(true);
  });

  it('preserves complete numeric prose with terminal punctuation', () => {
    const numericProse = 'The measured score increased from 4 to 5.';
    const count = 'There are 5.';
    const evidence = indexPodcastEvidence(`${numericProse}\n\n${count}`);

    expect(evidence.passages.map(({text}) => text)).toEqual([numericProse, count]);
  });

  it('does not classify substantive numeric prose as a contents list', () => {
    const numericProse = 'Index cases increased from 12 to 18 across 3 clinics, while the measured outcome remained uncertain.';
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: ['p1']}), [{id: 'p1', text: numericProse}], 'Alex', 'Sarah', false, 'brief', 350,
    );
    expect(compiled.segments.map(({text}) => text)).toContain(numericProse);
  });

  it('gives brief and standard distinct coverage instructions', async () => {
    await generatePodcastScript('One source passage with a point and qualification.', { type: 'brief' });
    const brief = vi.mocked(chatCompletion).mock.calls[0][0].messages[1].content;
    await generatePodcastScript('One source passage with a point and qualification.', { type: 'standard' });
    const standard = vi.mocked(chatCompletion).mock.calls[1][0].messages[1].content;
    expect(brief).toContain('fewest passages needed for the central point');
    expect(standard).toContain('Balance central points with relevant qualifications');
    expect(standard).not.toContain('fewest passages needed');
  });

  it('keeps source headings as provenance metadata and preserves passage text exactly', () => {
    const first = 'The first claim is limited to the measured sample.';
    const second = 'No causal conclusion is reported.';
    const evidence = indexPodcastEvidence(`SOURCE: Study\nSTRUCTURE: CHAPTER 1 · CHAPTER 2\nCOVERAGE: partial; selected evidence excerpts.\n\n[CHAPTER 1]\n${first}\n\n[CHAPTER 2]\n${second}`);
    expect(evidence.passages).toEqual([
      {id: 'p1', text: first, sectionHeading: 'CHAPTER 1'},
      {id: 'p2', text: second, sectionHeading: 'CHAPTER 2'},
    ]);
  });

  it('compiles genuinely different mode structures while keeping spoken evidence literal and ordered', () => {
    const passages = [
      {id: 'p1', text: 'The first claim is limited to the measured sample.', sectionHeading: 'CHAPTER 1'},
      {id: 'p2', text: 'No causal conclusion is reported.', sectionHeading: 'CHAPTER 2'},
    ];
    const plan = JSON.stringify({passageIds: ['p2', 'p1']});
    const brief = compilePodcastEvidence(plan, passages, 'Alex', 'Sarah', false, 'brief', 350);
    const standard = compilePodcastEvidence(plan, passages, 'Alex', 'Sarah', false, 'standard', 1200);
    const deep = compilePodcastEvidence(plan, passages, 'Alex', 'Sarah', false, 'deep-dive', 4500);
    const deepText = deep.segments.map(({text}) => text);

    expect(brief.segments.map(({text}) => text)).toContain(passages[0].text);
    expect(brief.segments.map(({text}) => text)).toContain(passages[1].text);
    expect(brief.segments.findIndex(({text}) => text === passages[0].text)).toBeLessThan(
      brief.segments.findIndex(({text}) => text === passages[1].text),
    );
    expect(standard.segments.some(({text}) => text === 'Passage 1.')).toBe(true);
    expect(deepText).toContain('Let’s turn to CHAPTER 1.');
    expect(deepText).toContain('Let’s turn to CHAPTER 2.');
    expect(deepText).toContain('CHAPTER 1, passage 1.');
    expect(deepText).toContain('What is the main point? What qualifies it?');
    expect(deep.segments.filter(({text}) => passages.some((p) => p.text === text)).map(({text}) => text))
      .toEqual(passages.map(({text}) => text));
    expect(deepText.join(' ')).not.toContain('caused');
    expect(deepText.join(' ')).not.toContain('must be supported by the source wording');
  });
});
