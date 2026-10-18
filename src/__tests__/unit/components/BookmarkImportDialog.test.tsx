import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarkImportDialog from '@/components/notebook/BookmarkImportDialog';

const mocks = vi.hoisted(() => ({ authenticated: true, importTweets: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mocks.authenticated ? { access_token: 'test-token' } : null }) }));
vi.mock('@/hooks/useSignalQueue', () => ({ useSignalQueue: () => ({ importTweets: mocks.importTweets, isImporting: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
afterEach(cleanup);
beforeEach(() => { mocks.authenticated = true; vi.clearAllMocks(); });
const open = () => render(<BookmarkImportDialog open onOpenChange={vi.fn()} notebookId="owned-notebook" />);

describe('bookmark import pre-submit feedback', () => {
  it('shows the guest requirement before submission and never attempts an import', async () => {
    mocks.authenticated = false;
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Sign in to import');
    await userEvent.type(screen.getByLabelText('Paste X / Twitter URL(s)'), 'https://x.com/cedar/status/123');
    const button = screen.getByRole('button', { name: 'Import 1 Tweet' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.importTweets).not.toHaveBeenCalled();
  });
  it('blocks the reproduced lookalike URL and mixed valid/invalid rows, then imports deduplicated valid rows', async () => {
    open();
    const input = screen.getByLabelText('Paste X / Twitter URL(s)');
    fireEvent.change(input, { target: { value: 'https://example.com/x.com/not-a-tweet' } });
    expect(screen.getByRole('alert')).toHaveTextContent('1 invalid link');
    expect(screen.getByRole('button', { name: 'Import 0 Tweets' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'https://x.com/cedar/status/123\nhttps://x.com/cedar' } });
    expect(screen.getByRole('button', { name: 'Import 1 Tweet' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'https://x.com/cedar/status/123\nhttps://twitter.com/cedar/status/123?s=20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 Tweet' }));
    expect(mocks.importTweets).toHaveBeenCalledWith({ notebookId: 'owned-notebook', urls: ['https://x.com/cedar/status/123'] });
  });
  it('clears a previously valid archive when its replacement is malformed', async () => {
    open();
    await userEvent.click(screen.getByRole('tab', { name: 'Twitter Archive JS/JSON' }));
    const input = screen.getByLabelText('Upload Bookmarks Export File');
    fireEvent.change(input, { target: { files: [new File(['[{"tweetId":"123"}]'], 'bookmarks.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import Archive' })).toBeEnabled());
    fireEvent.change(input, { target: { files: [new File(['not JSON https://x.com/cedar/status/123'], 'broken.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Cannot read this archive'));
    expect(screen.getByRole('button', { name: 'Import Archive' })).toBeDisabled();
    expect(mocks.importTweets).not.toHaveBeenCalled();
  });
});
