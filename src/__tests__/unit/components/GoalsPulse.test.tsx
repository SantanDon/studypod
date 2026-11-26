import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GoalsPulse from '@/components/dashboard/GoalsPulse';

const state = vi.hoisted(() => ({
  account: 'first' as string | null,
  fetchGoals: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: state.account && { id: state.account, account_type: state.account === 'guest' ? 'guest' : 'cloud' },
    session: state.account && { access_token: 'synthetic-session' },
    isAuthenticated: Boolean(state.account),
  }),
}));
vi.mock('@/services/apiService', () => ({ ApiService: { fetchResearchGoals: state.fetchGoals } }));

function showGoals(notebooks: { id: string; title?: string }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const dashboard = (books: typeof notebooks) => (
    <QueryClientProvider client={client}>
      <MemoryRouter><GoalsPulse notebooks={books} /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(dashboard(notebooks));
  return (books: typeof notebooks) => view.rerender(dashboard(books));
}

beforeEach(() => {
  state.account = 'first';
  state.fetchGoals.mockReset();
});
afterEach(cleanup);

it('isolates cached goals on same-count notebook and account changes', async () => {
  state.fetchGoals.mockImplementation(async (id: string) => ({
    goals: [{ id: 'goal', title: [state.account, id].join(' ') }],
  }));
  const update = showGoals([{ id: 'book-a', title: 'Original title' }]);
  expect(await screen.findByText('first book-a')).toBeVisible();
  update([{ id: 'book-a', title: 'Edited title' }]);
  expect(screen.getByRole('link', { name: 'Edited title' })).toBeVisible();
  expect(state.fetchGoals).toHaveBeenCalledTimes(1);

  update([{ id: 'book-b' }]);
  expect(screen.queryByText('first book-a')).not.toBeInTheDocument();
  expect(await screen.findByText('first book-b')).toBeVisible();

  state.account = 'second';
  update([{ id: 'book-b' }]);
  expect(screen.queryByText('first book-b')).not.toBeInTheDocument();
  expect(await screen.findByText('second book-b')).toBeVisible();
});

it('starts up to six requests concurrently and cancels obsolete queries', async () => {
  state.fetchGoals.mockImplementation((id: string) => id === '0'
    ? Promise.resolve({ goals: [{ id: 'goal', title: 'Ready question' }] })
    : new Promise(() => {}));
  const update = showGoals(Array.from({ length: 8 }, (_, index) => ({ id: String(index) })));
  expect(screen.getByRole('status')).toHaveTextContent('Loading research goals');
  expect(state.fetchGoals).toHaveBeenCalledTimes(6);
  expect(await screen.findByText('Ready question')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Loading more research goals');
  const signals: AbortSignal[] = state.fetchGoals.mock.calls.slice(1).map(([, , opts]) => opts.signal);
  state.account = 'guest';
  update([{ id: 'guest' }]);
  expect(screen.getByText('Sign in to save research questions and track them here.')).toBeVisible();
  expect(state.fetchGoals).toHaveBeenCalledTimes(6);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('shows partial errors alongside successful goals and retries only failures', async () => {
  state.fetchGoals.mockImplementation(async (id: string) => {
    if (id === 'broken') throw new Error('Network unavailable');
    return { goals: [{ id: 'goal', title: 'Available question' }] };
  });
  showGoals([{ id: 'good' }, { id: 'broken' }]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Some research goals could not be loaded.');
  expect(screen.getByText('Available question')).toBeVisible();

  state.fetchGoals.mockResolvedValue({ goals: [{ id: 'recovered', title: 'Recovered question' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading goals' }));
  expect(await screen.findByText('Recovered question')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(state.fetchGoals.mock.calls.map(([id]) => id).sort()).toEqual(['broken', 'broken', 'good']);
});

it('distinguishes a failed fetch from an empty result', async () => {
  state.fetchGoals.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue({ goals: [] });
  showGoals([{ id: 'book' }]);
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Research goals could not be loaded/);
  expect(screen.queryByText('No goals yet')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading goals' }));
  await waitFor(() => expect(screen.getByText('No goals yet')).toBeVisible());
});
