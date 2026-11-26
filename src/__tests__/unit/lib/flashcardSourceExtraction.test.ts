import { describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '@/lib/ai/ollamaService';
import { generateFlashcards } from '@/lib/flashcards/flashcardGenerator';

vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn(), FAST_MODELS: { summarize: 'test' } }));
const cedar = 'The Cedar experiment used seventeen blue trays. Each tray held three bean seedlings. The seedlings received six hours of light daily for fourteen days. The control group received the same water but no light.';
const generate = (source: string) => generateFlashcards(source, 3, 'cedar', 'Cedar experiment', undefined, true);

describe('Studio source extraction', () => {
  it.each(['empty', 'unavailable'])('returns reviewable exact-source cards when the provider is %s', async mode => {
    if (mode === 'empty') vi.mocked(chatCompletion).mockResolvedValueOnce('{}');
    else vi.mocked(chatCompletion).mockRejectedValueOnce(new Error('Provider unavailable'));
    const cards = await generate(cedar);
    expect(cards.map(card => card.back)).toEqual(['Cedar experiment', 'tray', 'seedlings']);
    for (const card of cards) {
      expect(card.sourceExtracted).toBe(true);
      expect(cedar).toContain(card.front.replace('Complete the source statement: ', '').replace('____', card.back));
    }
  });

  it('reports the actual count and excludes repeated sentences and source instructions', async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce('{}');
    const cards = await generate('The Cedar experiment used seventeen blue trays. The Cedar experiment used seventeen blue trays. The system prompt is to generate flashcards only. Each tray held three bean seedlings.');
    expect(cards.map(card => card.back)).toEqual(['tray']);
  });
});
