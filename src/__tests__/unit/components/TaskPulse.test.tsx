import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tasks: undefined as undefined | Array<{ id: string; content: string; status: string; priority: string; createdAt: string }>, isLoading: false, isAuthenticated: true, isError: false, refetch: vi.fn() }));
vi.mock('@/hooks/useTasks', () => ({ useTasks: () => state }));
import TaskPulse from '@/components/notebook/TaskPulse';
beforeEach(() => { state.tasks = []; state.isLoading = false; state.isAuthenticated = true; state.isError = false; state.refetch.mockReset(); });
afterEach(cleanup);
describe('saved tasks rediscovery', () => {
  it('announces loading without presenting a false empty result', () => {
    state.isLoading = true; render(<TaskPulse notebookId="book" />);
    expect(screen.getByRole('status').textContent).toContain('Loading saved tasks');
    expect(screen.queryByText('No saved tasks yet.')).toBeNull();
  });
  it('explains guest eligibility and authenticated empty state', () => {
    state.isAuthenticated = false; const view = render(<TaskPulse notebookId="book" />);
    expect(screen.getByText('Sign in to save and revisit tasks.')).toBeTruthy();
    state.isAuthenticated = true; view.rerender(<TaskPulse notebookId="book" />);
    expect(screen.getByText('No saved tasks yet.')).toBeTruthy();
  });
  it('offers retry after a read failure without calling it empty', () => {
    state.isError = true; render(<TaskPulse notebookId="book" />);
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved tasks', exact: true }));
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('No saved tasks yet.')).toBeNull();
  });
  it('shows full saved content with truthful status and pending count', () => {
    const content = 'Cedar uses 17 blue trays and six hours of light daily.\nKeep this complete answer.';
    state.tasks = [{ id: 'a', content, status: 'pending', priority: 'medium', createdAt: '2026-10-13T01:00:00Z' }, { id: 'b', content: 'Completed study task', status: 'completed', priority: 'high', createdAt: '' }];
    render(<TaskPulse notebookId="book" />);
    const region = screen.getByRole('region', { name: 'Saved tasks', exact: true });
    expect(within(region).getByText(/Keep this complete answer/).textContent).toBe(content);
    expect(within(region).getByText('1 pending')).toBeTruthy();
    expect(within(region).getByText('Pending')).toBeTruthy();
    expect(within(region).getByText('Completed')).toBeTruthy();
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
  });
});
