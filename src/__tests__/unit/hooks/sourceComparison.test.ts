import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn() }));
import { COMPARISON_CHARACTER_LIMIT, comparisonSourceText, isComparisonResult } from '@/components/notebook/hooks/useSourceComparison';

const complete = () => ({ commonThemes: ['Shared method'], uniquePointsSource1: ['17 trays'], uniquePointsSource2: ['19 trays'], contradictions: ['Different tray counts'], sharedKeywords: ['trays'] });

describe('comparison model result boundary', () => {
  it('accepts complete results and empty finding arrays', () => {
    expect(isComparisonResult(complete())).toBe(true);
    expect(isComparisonResult(Object.fromEntries(Object.keys(complete()).map(key => [key, []])))).toBe(true);
  });
  for (const key of Object.keys(complete())) {
    it(`rejects missing, non-array and unsafe entries in ${key}`, () => {
      const missing: Record<string, unknown> = complete();
      delete missing[key];
      expect(isComparisonResult(missing)).toBe(false);
      for (const value of [null, 'text', [{}], [null], [5], [''], ['  '], ['safe', { unsafe: true }]]) {
        expect(isComparisonResult({ ...complete(), [key]: value })).toBe(false);
      }
    });
  }
  it('rejects non-object responses', () => {
    for (const value of [null, undefined, [], 'answer', 7]) expect(isComparisonResult(value)).toBe(false);
  });
});

describe('disclosed comparison excerpt budget', () => {
  it('bounds content and fallback summaries equally', () => {
    const long = 'a'.repeat(COMPARISON_CHARACTER_LIMIT + 100);
    expect(comparisonSourceText({ content: long, summary: 'summary' })).toBe(long.slice(0, COMPARISON_CHARACTER_LIMIT));
    expect(comparisonSourceText({ content: '', summary: long })).toHaveLength(COMPARISON_CHARACTER_LIMIT);
  });
  it('uses text before summary and handles absent evidence', () => {
    expect(comparisonSourceText({ content: 'source evidence', summary: 'summary' })).toBe('source evidence');
    expect(comparisonSourceText({})).toBe('');
  });
});
