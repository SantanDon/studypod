import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '@/lib/ai/ollamaService';
import { generateQuizFromContent } from '@/lib/quiz/quizGenerator';
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/config/ollamaModels', () => ({ getModelForTask: () => 'test-model' }));
const statement = { question: 'Cedar uses seventeen blue trays.', options: ['True', 'False'], correctAnswer: 0, explanation: 'The source specifies seventeen blue trays.' };
const generate = (questions: unknown[], count = questions.length, type: 'true_false' | 'multiple_choice' = 'true_false') => {
  vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({ questions }));
  return generateQuizFromContent('Cedar uses seventeen blue trays.', 'book', count, 'medium', type);
};
beforeEach(() => vi.clearAllMocks());
describe('quiz generation batch boundary', () => {
  it('accepts declarative true and false statements and prompts with the TF shape', async () => {
    const falseStatement = { ...statement, question: 'Cedar uses twenty blue trays.', correctAnswer: 1 };
    const quiz = await generate([statement, falseStatement]);
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions.map(q => q.correctAnswer)).toEqual([0, 1]);
    const messages = vi.mocked(chatCompletion).mock.calls[0][0].messages;
    expect(messages[0].content).toContain('declarative factual statement');
    expect(messages[0].content).not.toContain('GOOD MULTIPLE CHOICE QUESTIONS');
    expect(messages[1].content).toContain('A single declarative claim');
    expect(messages[1].content).not.toContain('Option A');
  });
  it.each([
    'According to the text, how many blue trays are used in the Cedar experiment?',
    'How many blue trays are used',
    'Are seventeen blue trays used',
    'Cedar uses seventeen blue trays?',
    'According to the source, does Cedar use seventeen blue trays',
  ])('rejects an interrogative statement: %s', async question => {
    await expect(generate([{ ...statement, question }])).rejects.toThrow('invalid quiz batch');
  });
  it.each([['False', 'True'], ['Yes', 'No'], ['true', 'false']])('rejects noncanonical TF options %s/%s', async (first, second) => {
    await expect(generate([{ ...statement, options: [first, second] }])).rejects.toThrow('invalid quiz batch');
  });
  it('rejects the entire mixed batch rather than silently dropping its invalid item', async () => {
    await expect(generate([statement, { ...statement, question: 'How many trays?' }])).rejects.toThrow('invalid quiz batch');
  });
  it.each([1, 3])('rejects a batch with %i items when two were requested', async count => {
    await expect(generate(Array.from({ length: count }, () => statement), 2)).rejects.toThrow('invalid quiz batch');
  });
  it('preserves MCQ generation but rejects a partially valid MCQ batch', async () => {
    const mcq = { ...statement, question: 'How many trays are used?', options: ['15', '17', '20', '25'], correctAnswer: 1 };
    expect((await generate([mcq], 1, 'multiple_choice')).questions[0].type).toBe('multiple_choice');
    await expect(generate([mcq, { ...mcq, correctAnswer: 9 }], 2, 'multiple_choice')).rejects.toThrow('invalid quiz batch');
  });
});
