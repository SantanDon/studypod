import { describe, expect, it } from 'vitest';
import { buildPodcastEvidenceContext } from '@/lib/podcastGenerator';
import { indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';

describe('deep podcast source coverage', () => {
  it('distributes deep-sized contexts across explicit book divisions and retains complete passages', () => {
    const source = [
      'Introduction and Analysis.',
      ...Array.from({length: 12}, (_, index) => `Introduction passage ${index + 1}. ` + 'The full introductory argument retains its qualification. '.repeat(5)),
      ...Array.from({length: 4}, (_, bookIndex) => [
        `Book ${['I', 'II', 'III', 'IV'][bookIndex]}.`,
        ...Array.from({length: 12}, (_, index) => `Book ${bookIndex + 1} passage ${index + 1}. ` + 'This complete book passage states a point and its qualification. '.repeat(5)),
      ].join('\n\n')),
    ].join('\n\n');

    const standard = indexPodcastEvidence(buildPodcastEvidenceContext([{id: 'book', title: 'Large book', content: source}], {maxChars: 12_000}), 12_000);
    const deep = indexPodcastEvidence(buildPodcastEvidenceContext([{id: 'book', title: 'Large book', content: source}], {maxChars: 30_000}), 30_000);
    const deepSections = new Set(deep.passages.map(passage => passage.sectionHeading));

    expect(deepSections).toEqual(new Set(['Introduction and Analysis', 'Book I', 'Book II', 'Book III', 'Book IV']));
    expect(standard.passages.some(passage => passage.sectionHeading === 'Book IV')).toBe(false);
    expect(deep.passages.every(passage => /[.!?]$/.test(passage.text))).toBe(true);
    expect(deep.budgetedChars).toBeGreaterThan(standard.budgetedChars);
    expect(deep.budgetedChars).toBeLessThanOrEqual(30_000);
  });
});
