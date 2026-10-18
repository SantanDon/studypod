import { describe, expect, it } from 'vitest';
import { podcastGenerationBudget } from '../../../../e2e/audio-generation-budget';

describe('measured podcast acceptance generation budget', () => {
  it('allows cold initialization and five real segments beyond the prematurely expired 150s oracle', () => {
    const budget = podcastGenerationBudget(5);
    expect(budget.timeoutMs).toBe(270_000);
    expect(budget.timeoutMs).toBeGreaterThan(85_830 + 5 * 19_749);
    expect(budget.expectedSegments).toBe(5);
  });
  it('scales with script segments but never permits an unbounded wait', () => {
    expect(podcastGenerationBudget(1).timeoutMs).toBe(150_000);
    expect(podcastGenerationBudget(8).timeoutMs).toBe(360_000);
    expect(podcastGenerationBudget(100).timeoutMs).toBe(360_000);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid script segment count %s', count => {
    expect(() => podcastGenerationBudget(count)).toThrow('real nonempty podcast script');
  });
});
