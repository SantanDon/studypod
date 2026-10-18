// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithNotebook } from '../services/aiChatService.js';
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../services/titanProvider.js', () => ({ dispatchToTitan: dispatch }));
beforeEach(() => dispatch.mockReset());
let serial = 0;
const cases = [
  ['decimal suffix', 'The dose is 1.5 grams.', '5 grams.', 'What is the dose?'],
  ['decimal erasure', 'The dose is 1.5 grams.', 'The dose is 15 grams.', 'What is the dose?'],
  ['negative sign', 'The temperature is -5 degrees.', 'The temperature is 5 degrees.', 'What is the temperature?'],
  ['positive sign', 'The temperature is +5 degrees.', 'The temperature is 5 degrees.', 'What is the temperature?'],
  ['unicode sign', 'The temperature is −5 degrees.', 'The temperature is 5 degrees.', 'What is the temperature?'],
  ['percent', 'The solution is 5% saline.', 'The solution is 5 saline.', 'What is the solution?'],
  ['unit case', 'The solution contains 5 mM salt.', 'The solution contains 5 mm salt.', 'What does the solution contain?'],
  ['daily unit', 'The dose is 5 grams daily.', 'The dose is 5 grams.', 'What is the dose?'],
  ['qualifier', 'The dose is at most 5 grams.', 'The dose is 5 grams.', 'What is the dose?'],
  ['operator', 'The result is x < 5.', 'The result is x > 5.', 'What is the result?'],
  ['wrong subject', 'Each tray contains three seedlings.', 'The experiment contains three seedlings.', 'What does each tray contain?'],
  ['unsupported polarity', 'The dose is 5 grams.', 'The dose is not 5 grams.', 'What is the dose?'],
];
const mark = (claim, position) => position === 'before' ? claim.slice(0, -1) + ' [1].' : claim + '[1]';
async function run(source, claim, query, position = 'after') {
  dispatch.mockResolvedValue({ answer: `${mark(claim, position)}\nCITATIONS:\n[1] "${source}"`, tokensUsed: 1, modelUsed: 'offline-mock' });
  return chatWithNotebook({ notebook: { id: `numeric-api-${++serial}`, title: 'Synthetic' }, sources: [{ id: 'synthetic-source', title: 'Synthetic', type: 'text', content: source }], notes: [], message: query, allowWebFallback: false });
}
describe('actual chat API numeric fidelity across marker positions', () => {
  for (const position of ['before', 'after']) {
    it.each(cases)(`${position} marker rejects %s`, async (_label, source, changed, query) => {
      await expect(run(source, changed, query, position)).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
      expect(dispatch).toHaveBeenCalledTimes(2);
    });
    it.each(cases.filter(([label]) => label !== 'unsupported polarity'))(`${position} marker accepts literal %s`, async (_label, source, _changed, query) => {
      const result = await run(source, source, query, position);
      expect(result.citations[0].excerpt).toBe(source);
      expect(result.groundedSources).toEqual(['synthetic-source']);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  }
  it('preserves ordinary nonnumeric prose with a historical year in evidence', async () => {
    const source = 'In 1796, green plants consume carbon dioxide and release oxygen under light.';
    const result = await run(source, 'Green plants consume carbon dioxide and release oxygen under light.', 'Which gas do green plants consume?');
    expect(result.citations[0].excerpt).toBe(source);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('rejects quoted numeric assertions rather than erasing quote delimiters', async () => {
    await expect(run('The dose is 5 grams.', '"The dose is 5 grams."', 'What is the dose?')).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
  });
  it('rejects an empty marker fragment after a quoted numeric sentence boundary', async () => {
    dispatch.mockResolvedValue({ answer: '"The dose is 5 grams. [1].\nCITATIONS:\n[1] "The dose is 5 grams."', tokensUsed: 1, modelUsed: 'offline-mock' });
    await expect(chatWithNotebook({ notebook: { id: `split-quote-${++serial}`, title: 'Synthetic' }, sources: [{ id: 'synthetic-source', title: 'Synthetic', type: 'text', content: 'The dose is 5 grams.' }], notes: [], message: 'What is the dose?', allowWebFallback: false })).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
  });
  it.each(['The dose is 6 grams. See [1].', 'The dose is 6 grams. The dose is described here [1].', 'The dose is 6 grams. The dose is 5 grams.[1]\nThe dose is 5 grams.[1]'])('rejects an uncited quantity shielded by later citations: %s', async (body) => {
    dispatch.mockResolvedValue({ answer: `${body}\nCITATIONS:\n[1] "The dose is 5 grams."`, tokensUsed: 1, modelUsed: 'offline-mock' });
    await expect(chatWithNotebook({ notebook: { id: `uncited-quantity-${++serial}`, title: 'Synthetic' }, sources: [{ id: 'synthetic-source', title: 'Synthetic', type: 'text', content: 'The dose is 5 grams.' }], notes: [], message: 'What is the dose?', allowWebFallback: false })).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
  });
  it('allows an ordinary uncited introduction before a literal quantitative citation', async () => {
    const result = await run('The dose is 5 grams.', 'The source describes the dose. The dose is 5 grams.', 'What is the dose?');
    expect(result.citations[0].excerpt).toBe('The dose is 5 grams.');
  });
  for (const position of ['before', 'after']) {
    it(`${position} marker rejects unsupported nonnumeric negation`, async () => {
      await expect(run('Plants release oxygen.', 'Plants do not release oxygen.', 'What do plants release?', position)).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
    });
    it(`${position} marker rejects erased nonnumeric negation`, async () => {
      await expect(run('Plants do not release oxygen.', 'Plants release oxygen.', 'What do plants release?', position)).rejects.toMatchObject({ code: 'GROUNDING_UNAVAILABLE' });
    });
    it(`${position} marker preserves supported literal nonnumeric negation`, async () => {
      const result = await run('Plants do not release oxygen.', 'Plants do not release oxygen.', 'What do plants release?', position);
      expect(result.citations[0].excerpt).toBe('Plants do not release oxygen.');
    });
  }
});
