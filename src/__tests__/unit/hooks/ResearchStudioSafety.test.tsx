import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
type TestGoal = { id: string; title: string; status: 'active' | 'completed'; parent_goal_id?: string };
const state = vi.hoisted(() => ({
  authenticated: true, current: true, invalidate: vi.fn(), toast: vi.fn(), chat: vi.fn(),
  goals: [] as TestGoal[],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: state.authenticated ? { access_token: 'test-session' } : null }) }));
vi.mock('@/services/studioApiService', () => ({ useStudioIdentity: () => ({ key: 'account:test:book', ready: true, authenticated: state.authenticated, assertCurrent: () => { if (!state.current) throw new Error('Account changed'); } }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/hooks/useResearchGoals', () => ({
  useResearchGoals: () => ({ goals: state.goals, isLoading: false, createGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn() }),
  useSuggestedGoals: () => ({ suggestions: [], isLoading: false }),
}));
vi.mock('@/services/apiService', () => ({ default: { sendChatMessage: state.chat, fetchAgentMissions: vi.fn().mockResolvedValue({ missions: [] }) } }));
import ResearchGoalsPanel from '@/components/notebook/ResearchGoalsPanel';
import AgentMissionPanel from '@/components/notebook/AgentMissionPanel';
import SuggestedGoalsForSource, { parseGoalChunkIndices } from '@/components/notebook/SuggestedGoalsForSource';

beforeEach(() => { state.authenticated = true; state.current = true; state.goals = []; state.invalidate.mockReset().mockResolvedValue(undefined); state.toast.mockReset(); state.chat.mockReset(); });
afterEach(cleanup);

describe('research Studio safe interaction boundaries', () => {
  it('ignores broken JSON and keeps only safe nonnegative chunk indices', () => {
    for (const value of ['{broken', 'null', '{}', '7', null, undefined]) expect(parseGoalChunkIndices(value)).toEqual([]);
    expect(parseGoalChunkIndices('[0, 2, -1, 1.2, "3", null, {}]')).toEqual([0, 2]);
    expect(parseGoalChunkIndices([0, Infinity, Number.MAX_SAFE_INTEGER + 1, 4])).toEqual([0, 4]);
  });
  it('explains account eligibility without showing runnable guest tools', () => {
    state.authenticated = false;
    render(<><AgentMissionPanel notebookId="book" /><ResearchGoalsPanel notebookId="book" /><SuggestedGoalsForSource notebookId="book" sourceId="source" /></>);
    expect(screen.getByText(/Sign in to create research missions/)).toBeTruthy();
    expect(screen.getByText(/Sign in to save research goals/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Synthesize' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create and run mission' })).toBeNull();
    expect(state.chat).not.toHaveBeenCalled();
  });
  it('refreshes owner-qualified Notes via the notebook prefix and displays the actual synthesis result', async () => {
    state.chat.mockResolvedValue({ answer: 'No active research goals.' });
    render(<ResearchGoalsPanel notebookId="book" />);
    fireEvent.click(screen.getByRole('button', { name: 'Synthesize' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith({ title: 'Synthesis result', description: 'No active research goals.' }));
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['notes', 'book'] });
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['researchGoals', 'book'] });
  });
  it('discards a synthesis completion after the active identity changes', async () => {
    let finish!: (value: unknown) => void;
    state.chat.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ResearchGoalsPanel notebookId="book" />);
    fireEvent.click(screen.getByRole('button', { name: 'Synthesize' }));
    state.current = false; finish({ answer: 'Saved another account result' });
    await waitFor(() => expect(state.chat).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });
  it('keeps an active child visible when its completed parent is filtered out', () => {
    state.goals = [{ id: 'parent', title: 'Completed parent', status: 'completed' }, { id: 'child', title: 'Active child', status: 'active', parent_goal_id: 'parent' }];
    render(<ResearchGoalsPanel notebookId="book" />);
    expect(screen.getByText('Active child')).toBeTruthy();
    expect(screen.queryByText('Completed parent')).toBeNull();
  });
});
