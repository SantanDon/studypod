import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn(), FAST_MODELS: { summarize: 'mock-fast' } }));
import { chatCompletion } from '@/lib/ai/ollamaService';
import { generateFlashcards } from '@/lib/flashcards/flashcardGenerator';
const model = vi.mocked(chatCompletion);
const first = 'The Cedar experiment uses exactly 17 blue trays.';
const second = 'The seedlings receive light for six hours daily.';
const third = 'Water is measured every morning in the research greenhouse.';
const source = [first, second, third].join(' ');
const card = (evidence:string, answer:string) => JSON.stringify({type:'fact',evidence,answer});
const initial = [card(first,'blue trays'), card(second,'seedlings receive light for six'), card(third,'measured every morning in the research')].join('\n');
const repaired = [card(second,'six hours'),card(third,'greenhouse')].join('\n');
const generate = () => generateFlashcards(source,3,'synthetic-owned','Synthetic source');
beforeEach(() => model.mockReset());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('bounded grounded selection correction', () => {
  it('retains approved cards and regenerates two shorter meaningful literal selections', async () => {
    model.mockResolvedValueOnce(initial).mockResolvedValueOnce(repaired);
    const cards = await generate();
    expect(cards.map(card=>card.back)).toEqual(['blue trays','six hours','greenhouse']);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].messages[1].content).toContain(JSON.stringify([first]));
    expect(model.mock.calls[1][0].deadlineAt).toBe(model.mock.calls[0][0].deadlineAt);
    for(const selected of cards) expect(source).toContain(selected.front.replace('Complete the source statement: ','').replace('____',selected.back));
  });
  it('does not reuse an already approved sentence or accept fabricated evidence', async () => {
    model.mockResolvedValueOnce(initial).mockResolvedValueOnce([card(first,'Cedar experiment'),card('The seedlings receive light for seven hours daily.','seven hours')].join('\n'));
    await expect(generate()).rejects.toThrow('Only 1 of 3 requested');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('keeps final shortfall observable and never loops on invalid corrective selections', async () => {
    model.mockResolvedValue(initial);
    await expect(generate()).rejects.toThrow('Only 1 of 3 requested');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('does not retry sparse valid output or absent eligible records', async () => {
    model.mockResolvedValue(card(first,'blue trays'));
    await expect(generate()).rejects.toThrow('Only 1 of 3 requested');
    expect(model).toHaveBeenCalledTimes(1);
    model.mockReset().mockResolvedValue('{}');
    await expect(generate()).rejects.toThrow('Only 0 of 3 requested');
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('refills one answer-absent selection with exact source evidence', async () => {
    const absent = [card(first,'blue trays'),card(second,'six hours'),card(third,'daily water')].join('\n');
    model.mockResolvedValueOnce(absent).mockResolvedValueOnce(card(third,'greenhouse'));
    const cards = await generate();
    expect(cards).toHaveLength(3);
    expect(cards.map(card=>card.back)).toEqual(['blue trays','six hours','greenhouse']);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].deadlineAt).toBe(model.mock.calls[0][0].deadlineAt);
    expect(model.mock.calls[1][0].messages[1].content).toContain(JSON.stringify([first, second]));
  });
  it('fails visibly when answer-absent correction is still ungrounded', async () => {
    const absent = [card(first,'blue trays'),card(second,'six hours'),card(third,'daily water')].join('\n');
    model.mockResolvedValue(absent);
    await expect(generate()).rejects.toThrow('Only 2 of 3 requested');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('does not retry provider failure or hide corrective provider failure', async () => {
    model.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(generate()).rejects.toThrow('Provider unavailable');
    expect(model).toHaveBeenCalledTimes(1);
    model.mockReset().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Deadline exceeded'));
    await expect(generate()).rejects.toThrow('Deadline exceeded');
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('skips correction when the shared deadline has less than one second remaining', async () => {
    const clock=vi.spyOn(Date,'now').mockReturnValue(0);
    model.mockImplementationOnce(async()=>{clock.mockReturnValue(59001);return initial;});
    await expect(generate()).rejects.toThrow('Only 1 of 3 requested');
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0].deadlineAt).toBe(60000);
  });
  it('retains both safe diagnostic attempts without model or source text', async () => {
    vi.stubEnv('MODE','acceptance');vi.stubEnv('VITE_STUDYPOD_ACCEPTANCE_DIAGNOSTICS','true');
    const info=vi.spyOn(console,'info').mockImplementation(()=>{});
    model.mockResolvedValueOnce(initial).mockResolvedValueOnce(repaired);
    expect(await generate()).toHaveLength(3);
    expect(info).toHaveBeenCalledTimes(2);
    const values=info.mock.calls.map(call=>JSON.parse(String(call[0]).replace('[StudyPod flashcard acceptance] ','')));
    expect(values.map(value=>[value.requestedCount,value.selectedCards])).toEqual([[3,1],[2,2]]);
    expect(JSON.stringify(values)).not.toContain('Cedar');
    expect(values[0].rejections.answer_context_ratio).toBe(2);
  });
});

