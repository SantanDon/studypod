import {describe, expect, it} from 'vitest';
import {compilePodcastEvidence, indexPodcastEvidence} from '@/lib/audio/podcastEvidencePlan';

describe('podcast reading coherence', () => {
  it('omits clearly severed PDF citation and quoted sentence starts with partial coverage', () => {
    const source = 'Rep.; Polit.; Cratyl), although he has not always avoided confusion.\n\n'
      + '’shut him up.’ He has reached the stage of framing general notions.\n\n'
      + 'The complete passage does not claim that outcomes were measured.';
    const indexed = indexPodcastEvidence(source);
    expect(indexed.passages.map(p => p.text)).toEqual([
      'The complete passage does not claim that outcomes were measured.',
    ]);
    expect(indexed.excerpted).toBe(true);
  });

  it('preserves complete quotations and balanced parenthetical citations', () => {
    const source = '“The result remains uncertain,” she said (see Rep.; Polit.; Cratyl).';
    expect(indexPodcastEvidence(source).passages[0].text).toBe(source);
    const numbered = 'Figure 1) shows that no outcomes have been measured.';
    expect(indexPodcastEvidence(numbered).passages[0].text).toBe(numbered);
  });

  it('repairs explicit discretionary hyphens and known PDF split words only', () => {
    const source = 'The Di-\nalogues make a me- taphysical dis- tinction. The intel\u00ad\nlectual argument is qualified.';
    expect(indexPodcastEvidence(source).passages[0].text).toBe(
      'The Dialogues make a metaphysical distinction. The intellectual argument is qualified.',
    );
  });

  it('preserves intentional compounds, ambiguous words, negation and numbers', () => {
    const source = 'Well-\nbeing is not measured. Re- creation and co- operation are separate terms. '
      + 'The x_y value remains -12; outcomes are not established.';
    expect(indexPodcastEvidence(source).passages[0].text).toBe(source);
  });

  it('keeps literal readings in source order and asks each deep reflection only once', () => {
    const passages = Array.from({length: 16}, (_, index) => ({
      id: `p${index + 1}`, text: `Observation ${index + 1} remains qualified by the source.`,
    }));
    const compiled = compilePodcastEvidence(
      JSON.stringify({passageIds: passages.map(p => p.id).reverse()}), passages,
      'Alex', 'Sarah', false, 'deep-dive', 4500,
    );
    expect(compiled.segments.filter(s => s.text.startsWith('Observation')).map(s => s.text))
      .toEqual(passages.map(p => p.text));
    const prompts = compiled.segments.filter(s => /^What /.test(s.text));
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts.map(s => s.text)).size).toBe(3);
    const lastReading = compiled.segments.findIndex(s => s.text === passages[15].text);
    expect(compiled.segments[lastReading + 1].text).toBe('What can we conclude from these words?');
  });

  it('avoids repeated reflection prompts for standard mode', () => {
    const passages = Array.from({length: 4}, (_, index) => ({
      id: `p${index + 1}`, text: `Qualified observation ${index + 1}.`,
    }));
    const compiled = compilePodcastEvidence(JSON.stringify({passageIds: passages.map(p => p.id)}),
      passages, 'Alex', 'Sarah', false, 'standard', 1200);
    expect(compiled.segments.filter(s => s.text === 'What does it say? What remains unclear?'))
      .toHaveLength(1);
  });
});
