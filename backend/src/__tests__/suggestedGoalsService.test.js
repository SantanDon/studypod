// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ getSourcesByNotebookId: vi.fn(), getSignalQueueSuggestionsBySource: vi.fn(), upsertSignalQueueSuggestion: vi.fn(), updateSource: vi.fn() }));
const titan = vi.hoisted(() => ({ dispatchToTitan: vi.fn() }));
vi.mock('../db/database.js', () => ({ dbHelpers: db }));
vi.mock('../services/titanProvider.js', () => titan);
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
const { getOrComputeSuggestedGoals } = await import('../services/suggestedGoalsService.js');
beforeEach(() => vi.resetAllMocks());
it('checks accessible source before reading cache or dispatching', async () => {
  db.getSourcesByNotebookId.mockResolvedValue([]);
  expect(await getOrComputeSuggestedGoals('book', 'stranger', 'source')).toEqual({ suggestions: [], computed: false });
  expect(db.getSignalQueueSuggestionsBySource).not.toHaveBeenCalled(); expect(titan.dispatchToTitan).not.toHaveBeenCalled();
});
it('returns owned accepted cache using the full scope without generation', async () => {
  db.getSourcesByNotebookId.mockResolvedValue([{ id: 'source', content: 'Cedar' }]);
  db.getSignalQueueSuggestionsBySource.mockResolvedValue([{ status: 'accepted', acceptedGoalId: 'goal' }]);
  expect((await getOrComputeSuggestedGoals('book', 'owner', 'source')).suggestions[0].status).toBe('accepted');
  expect(db.getSignalQueueSuggestionsBySource).toHaveBeenCalledWith('source', 'book', 'owner');
  expect(titan.dispatchToTitan).not.toHaveBeenCalled();
});
it('explicit regeneration returns durable rows and rejects malformed suggestion objects', async () => {
  db.getSourcesByNotebookId.mockResolvedValue([{ id: 'source', title: 'Cedar', content: 'Plain water control.' }]);
  db.getSignalQueueSuggestionsBySource.mockResolvedValue([{ status: 'accepted', acceptedGoalId: 'goal' }]);
  titan.dispatchToTitan.mockResolvedValue({ answer: JSON.stringify([null, { title: 'bad', rationale: 'bad', sourceChunkIndices: [-1] }, { title: 'Compare controls', rationale: 'Plain water.', sourceChunkIndices: [0], confidence: 0.9 }]) });
  expect(await getOrComputeSuggestedGoals('book', 'owner', 'source', { force: true })).toEqual({ suggestions: [{ status: 'accepted', acceptedGoalId: 'goal' }], computed: true });
  expect(db.upsertSignalQueueSuggestion).toHaveBeenCalledTimes(1);
  expect(db.upsertSignalQueueSuggestion).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'source', notebookId: 'book', userId: 'owner', sourceChunkIndices: [0] }));
});
