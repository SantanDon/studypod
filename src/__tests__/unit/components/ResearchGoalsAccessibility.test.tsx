import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestedGoal } from '@/hooks/useResearchGoals';

const state = vi.hoisted(() => ({
  chat: vi.fn(), accept: vi.fn(), invalidate: vi.fn(), toast: vi.fn(),
  accepting: false, suggestions: [] as SuggestedGoal[],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'synthetic-session' } }) }));
vi.mock('@/services/studioApiService', () => ({ useStudioIdentity: () => ({ key: 'synthetic-owner:book', ready: true, authenticated: true, assertCurrent: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/config/featureFlags', () => ({ FEATURE_FLAGS: { SUGGESTED_GOALS_ENABLED: true } }));
vi.mock('@/hooks/useResearchGoals', () => ({
  useResearchGoals: () => ({ goals: [], isLoading: false, createGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn() }),
  useSuggestedGoals: () => ({ suggestions: state.suggestions, isLoading: false, acceptSuggestion: state.accept, isAccepting: state.accepting }),
}));
vi.mock('@/services/apiService', () => ({ default: { sendChatMessage: state.chat } }));
import ResearchGoalsPanel from '@/components/notebook/ResearchGoalsPanel';
import SuggestedGoalsForSource from '@/components/notebook/SuggestedGoalsForSource';

function assertDecorativeIcon(button: HTMLElement) {
  const icon = button.querySelector('i');
  expect(icon).not.toBeNull();
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
  // Simulate an icon font glyph without relying on jsdom's CSS pseudo-elements.
  if (icon) icon.textContent = '\ue001';
}

beforeEach(() => {
  state.chat.mockReset(); state.accept.mockReset().mockResolvedValue(undefined);
  state.invalidate.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
  state.accepting = false;
  state.suggestions = [{ id: 'suggestion', title: 'Compare light exposure', source_id: 'source', notebook_id: 'book', user_id: 'owner', rationale: null, source_chunk_indices: [0], confidence: 0.9, status: 'pending', created_at: '2026-10-13T00:00:00Z' }];
});
afterEach(cleanup);

describe('research action accessible names', () => {
  it('keeps Synthesize and its disabled busy state free of decorative glyphs', async () => {
    let finish!: (value: { answer: string }) => void;
    state.chat.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ResearchGoalsPanel notebookId="book" />);
    const action = screen.getByRole('button', { name: 'Synthesize', exact: true });
    assertDecorativeIcon(action);
    expect(screen.getByRole('button', { name: 'Synthesize', exact: true })).toBe(action);
    fireEvent.click(action);
    expect(state.chat).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole('button', { name: 'Syncing...', exact: true });
    assertDecorativeIcon(busy);
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Syncing...', exact: true })).toBe(busy);
    finish({ answer: 'No active research goals.' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Synthesize', exact: true })).toBeEnabled());
  });

  it('keeps Add and persisted Added states exact while retaining acceptance and disabled guards', async () => {
    const view = render(<SuggestedGoalsForSource notebookId="book" sourceId="source" />);
    const action = screen.getByRole('button', { name: 'Add', exact: true });
    assertDecorativeIcon(action);
    expect(screen.getByRole('button', { name: 'Add', exact: true })).toBe(action);
    fireEvent.click(action);
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(state.accept).toHaveBeenCalledExactlyOnceWith('suggestion');
    state.accepting = true;
    view.rerender(<SuggestedGoalsForSource notebookId="book" sourceId="source" />);
    expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    state.accepting = false; state.suggestions[0] = { ...state.suggestions[0], status: 'accepted' };
    view.rerender(<SuggestedGoalsForSource notebookId="book" sourceId="source" />);
    const added = screen.getByRole('button', { name: 'Added', exact: true });
    assertDecorativeIcon(added);
    expect(screen.getByRole('button', { name: 'Added', exact: true })).toBe(added);
    expect(added).toBeDisabled();
    fireEvent.click(added);
    expect(state.accept).toHaveBeenCalledTimes(1);
  });
});
