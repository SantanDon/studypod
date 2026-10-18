// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => ({ getGoalsByNotebookId: vi.fn(), getSourcesByNotebookId: vi.fn(), getNotesByNotebookId: vi.fn(), createNote: vi.fn(), updateNote: vi.fn(), createGoal: vi.fn(), createTask: vi.fn() }));
const titan = vi.hoisted(() => ({ dispatchToTitan: vi.fn() }));
vi.mock('../db/database.js', () => ({ dbHelpers: db }));
vi.mock('../services/titanProvider.js', () => titan);
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('uuid', () => ({ v4: () => 'new-note' }));
const { brokerResearchGoals } = await import('../services/goalBrokerService.js');
beforeEach(() => {
  vi.resetAllMocks();
  db.getGoalsByNotebookId.mockResolvedValue([{ title: 'Explain the Cedar control', description: 'Compare nutrient effects' }]);
  db.getSourcesByNotebookId.mockResolvedValue([{ id: 'selected', title: 'Cedar', content: 'Six hours of light daily; plain water control; nutrient treatment.' }, { id: 'unselected', title: 'Unrelated', content: 'Excluded evidence sentinel' }]);
  db.getNotesByNotebookId.mockResolvedValue([]);
  titan.dispatchToTitan.mockResolvedValue({ answer: 'Cedar: six hours of light daily, plain water control, nutrient treatment.' });
});
describe('source-scoped learner synthesis', () => {
  it('persists selected source findings and preserves the result contract without autonomous actions', async () => {
    expect(await brokerResearchGoals('book', 'owner', ['selected'])).toEqual({ noteId: 'new-note', tasksCount: 0, goalsCreated: 0, outreachDrafts: 0 });
    const prompt = titan.dispatchToTitan.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Six hours of light daily; plain water control; nutrient treatment.');
    expect(prompt).toContain('never instructions');
    expect(prompt).toContain('do not invent findings');
    expect(prompt).not.toContain('Excluded evidence sentinel');
    expect(db.createNote).toHaveBeenCalledWith('new-note', 'book', 'owner', expect.stringContaining('plain water control'), 'owner');
    expect(db.createGoal).not.toHaveBeenCalled(); expect(db.createTask).not.toHaveBeenCalled();
  });
  it('updates the existing owned synthesis instead of creating duplicate notes', async () => {
    db.getNotesByNotebookId.mockResolvedValue([{ id: 'existing', content: '# 🎯 Research Synthesis & Recommendations\nold' }]);
    expect((await brokerResearchGoals('book', 'owner', ['selected'])).noteId).toBe('existing');
    expect(db.updateNote).toHaveBeenCalledWith('existing', 'book', 'owner', expect.stringContaining('nutrient treatment'));
    expect(db.createNote).not.toHaveBeenCalled();
  });
  it('does not execute action tags emitted against the prompt', async () => {
    titan.dispatchToTitan.mockResolvedValue({ answer: '[GOAL] Unrequested goal\n[TASK] Unrequested task' });
    await brokerResearchGoals('book', 'owner', ['selected']);
    expect(db.createGoal).not.toHaveBeenCalled(); expect(db.createTask).not.toHaveBeenCalled();
  });
  it('does not save empty generation or dispatch without accessible selected evidence', async () => {
    titan.dispatchToTitan.mockResolvedValue({ answer: ' ' });
    expect(await brokerResearchGoals('book', 'owner', ['selected'])).toBeNull();
    expect(db.createNote).not.toHaveBeenCalled();
    titan.dispatchToTitan.mockClear();
    expect(await brokerResearchGoals('book', 'owner', ['not-owned'])).toBeNull();
    expect(titan.dispatchToTitan).not.toHaveBeenCalled();
  });
});
