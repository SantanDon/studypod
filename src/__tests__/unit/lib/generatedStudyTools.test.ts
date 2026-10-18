import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/ollamaService', () => ({
  chatCompletion: vi.fn(),
  FAST_MODELS: { summarize: 'mock-fast' },
}));

import { chatCompletion } from '@/lib/ai/ollamaService';
import { generateConceptMap } from '@/lib/conceptMap/conceptMapGenerator';
import { generateFlashcards } from '@/lib/flashcards/flashcardGenerator';
import { generateQuiz } from '@/lib/quiz/quizGenerator';
import type { LocalSource } from '@/services/localStorageService';

const mockedChatCompletion = vi.mocked(chatCompletion);
const sourceContent = 'Photosynthesis converts light energy into chemical energy in plants. Chlorophyll absorbs light, and the reactions produce glucose and oxygen.';
const source: LocalSource = {
  id: 'source-1',
  notebook_id: 'notebook-1',
  title: 'Plant Biology',
  content: sourceContent,
  type: 'text',
  created_at: '2026-07-24T00:00:00.000Z',
  updated_at: '2026-07-24T00:00:00.000Z',
};

describe('generated study tool output hardening', () => {
  beforeEach(() => {
    mockedChatCompletion.mockReset();
  });

  it('filters malformed flashcards, trims output, and honors the requested cap', async () => {
    mockedChatCompletion.mockResolvedValue([
      '{"type":"definition","evidence":"  Photosynthesis converts light energy into chemical energy in plants.  ","answer":"  light energy  "}',
      '{"type":"fact","front":"   ","back":"Invalid empty question"}',
      '{"type":"fact","front":"What absorbs light?","back":"   "}',
      '{"type":"fact","evidence":"Chlorophyll absorbs light, and the reactions produce glucose and oxygen.","answer":"Chlorophyll"}',
    ].join('\n'));

    const cards = await generateFlashcards(sourceContent, 1, source.id, source.title);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: 'Complete the source statement: Photosynthesis converts ____ into chemical energy in plants.',
      back: 'light energy',
      sourceId: source.id,
      sourceTitle: source.title,
      cardType: 'definition',
    });
  });

  it('rejects a mixed-validity quiz batch instead of silently truncating it', async () => {
    mockedChatCompletion.mockResolvedValue(JSON.stringify({
      questions: [
        {
          question: 'Which pigment absorbs light?',
          options: ['Chlorophyll', 'Glucose', 'Oxygen', 'Nitrogen'],
          correctAnswer: 0,
          explanation: 'The source identifies chlorophyll as the light-absorbing pigment.',
        },
        {
          question: 'Invalid answer index?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 9,
          explanation: 'Out of bounds.',
        },
        {
          question: 'Invalid option count?',
          options: ['A', 'B', 'C'],
          correctAnswer: 0,
          explanation: 'Only three options.',
        },
        {
          question: 'Empty explanation?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 0,
          explanation: '   ',
        },
      ],
    }));

    await expect(generateQuiz({
      sources: [source],
      numQuestions: 4,
      difficulty: 'medium',
      questionType: 'multiple_choice',
    })).rejects.toThrow('invalid quiz batch');
  });
  it('rejects quiz responses with no structurally valid questions', async () => {
    mockedChatCompletion.mockResolvedValue(JSON.stringify({
      questions: [{
        question: 'Broken question',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 7,
        explanation: 'Invalid index.',
      }],
    }));

    await expect(generateQuiz({
      sources: [source],
      numQuestions: 5,
      difficulty: 'hard',
    })).rejects.toThrow('invalid quiz batch');
  });

  it('removes duplicate nodes, empty nodes, self-loops, and dangling concept-map edges', async () => {
    mockedChatCompletion.mockResolvedValue(JSON.stringify({
      nodes: [
        { id: 'n1', label: 'light', type: 'main', description: 'Invented definition' },
        { id: 'n2', label: 'Chlorophyll', type: 'term', description: 'Light-absorbing pigment' },
        { id: 'n2', label: 'Duplicate chlorophyll', type: 'detail' },
        { id: 'n3', label: '   ', type: 'detail' },
      ],
      edges: [
        { id: 'e1', source: 'n2', target: 'n1', label: 'absorbs', type: 'related', evidence: 'Chlorophyll absorbs light during photosynthesis.' },
        { id: 'e2', source: 'n1', target: 'missing', type: 'related' },
        { id: 'e3', source: 'n1', target: 'n1', type: 'explains' },
        { id: 'e1', source: 'n2', target: 'n1', type: 'related' },
      ],
    }));

    const map = await generateConceptMap('Photosynthesis converts light energy into chemical energy in plants. Chlorophyll absorbs light during photosynthesis.', source.title);

    expect(map.nodes.map(node => node.label)).toEqual(['light', 'Chlorophyll']);
    expect(map.edges).toHaveLength(1);
    const nodeIds = new Set(map.nodes.map(node => node.id));
    expect(nodeIds.has(map.edges[0].source)).toBe(true);
    expect(nodeIds.has(map.edges[0].target)).toBe(true);
    expect(map.edges[0].source).not.toBe(map.edges[0].target);
  });

  it('rejects unusable source content before invoking the model', async () => {
    await expect(generateFlashcards('too short', 5, source.id, source.title))
      .rejects.toThrow('Content is too short');
    await expect(generateConceptMap('too short', source.title))
      .rejects.toThrow('Content is too short');
    await expect(generateQuiz({
      sources: [{ ...source, content: '   ' }],
      numQuestions: 5,
      difficulty: 'easy',
    })).rejects.toThrow('No content available');

    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });
});
