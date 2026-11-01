import { describe, expect, it } from 'vitest';
import { getQuoteGroundingIssue } from '@/lib/chat/quoteGrounding';

const sources = [
  { content: 'Justice is the virtue of the soul, and wisdom guides the city.' },
  { content: 'The unexamined life is not worth living.' },
];

describe('explicit quote grounding', () => {
  it('accepts an exact quoted substring with a nearby source citation', () => {
    expect(getQuoteGroundingIssue(
      'Can you give me a memorable quote?',
      '“Justice is the virtue of the soul” [1]\n\nIt highlights the text’s account of justice.',
      sources,
    )).toBeNull();
  });

  it('rejects a quote without a source citation', () => {
    expect(getQuoteGroundingIssue(
      'Give me an exact quote.',
      '“Justice is the virtue of the soul.”',
      sources,
    )).toMatch(/needs a source-number citation/);
  });

  it('requires a citation for a source-verified quote request with an appended thinking question', () => {
    const question = 'In BOOK I of the Republic, explain the opening discussion of justice using one short source-verified quote and its citation. Finish with one question for me to think about.';
    expect(getQuoteGroundingIssue(
      question,
      'Socrates challenges the definition of justice. “Justice is the virtue of the soul”',
      sources,
    )).toMatch(/needs a source-number citation/);
    expect(getQuoteGroundingIssue(
      question,
      'Socrates challenges the definition of justice. “Justice is the virtue of the soul” [1]',
      sources,
    )).toBeNull();
  });

  it('rejects a quote cited to the wrong source even when another source contains it', () => {
    expect(getQuoteGroundingIssue(
      'Please provide a verbatim quote.',
      '“Justice is the virtue of the soul” [2]',
      sources,
    )).toMatch(/could not be verified/);
  });

  it('rejects invented wording even when the answer cites a source', () => {
    expect(getQuoteGroundingIssue(
      'What is a memorable quote?',
      '“Wisdom alone creates the perfect city for every soul” [1]',
      sources,
    )).toMatch(/could not be verified/);
  });

  it('matches a whitespace-wrapped Markdown blockquote and following-paragraph citation', () => {
    expect(getQuoteGroundingIssue(
      'Give me an exact quote from the notes.',
      '> Justice is the virtue\n> of the soul, and wisdom\n> guides the city.\n\n[1] This is the cited passage.',
      sources,
    )).toBeNull();
  });

  it('rejects a response that mixes one supported quote with a fabricated quote', () => {
    expect(getQuoteGroundingIssue(
      'Can you give me memorable quotes?',
      '“Justice is the virtue of the soul” [1]\n\n“Wisdom alone creates the perfect city for every soul” [1]',
      sources,
    )).toMatch(/could not be verified/);
  });

  it('counts a quote-marked Markdown blockquote once and ignores its attribution', () => {
    expect(getQuoteGroundingIssue(
      'Give me a verbatim quote.',
      '> “Justice is the virtue of the soul”\n> — Plato [1]',
      sources,
    )).toBeNull();
  });

  it('allows an honest exact-wording abstention without a quotation', () => {
    expect(getQuoteGroundingIssue(
      'Can you find a memorable quote?',
      'I cannot verify the exact wording in the selected source text.',
      sources,
    )).toBeNull();
  });

  it('does not impose quote requirements on a normal explanation request', () => {
    expect(getQuoteGroundingIssue(
      'Explain what justice means in these notes.',
      'The notes describe justice as a virtue of the soul [1].',
      sources,
    )).toBeNull();
  });
});
