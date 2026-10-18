import { useState } from 'react';
import AddSourcesDialog from '@/components/notebook/AddSourcesDialog';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarkImportDialog from '@/components/notebook/BookmarkImportDialog';

const mocks = vi.hoisted(() => ({ authenticated: true, importTweets: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mocks.authenticated ? { access_token: 'test-token' } : null }) }));
vi.mock('@/hooks/useSignalQueue', () => ({ useSignalQueue: () => ({ importTweets: mocks.importTweets, isImporting: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/hooks/useGuest', () => ({
  useGuest: () => ({ isGuest: false, showAuthPrompt: vi.fn() }),
  useNotebookLimits: () => ({ canAddSource: true, sourcesRemaining: 10 }),
}));
vi.mock('@/components/notebook/hooks/useAddSourcesHandlers', () => ({ useAddSourcesHandlers: () => ({
  handleMultipleWebsiteSubmit: vi.fn(), handleYouTubeSubmit: vi.fn(), handleDrag: vi.fn(), handleDrop: vi.fn(), handleFileSelect: vi.fn(),
  dragActive: false, isProcessingFiles: false, pendingFileNames: [],
}) }));
vi.mock('@/components/notebook/MultipleWebsiteUrlsDialog', () => ({ default: () => null }));
vi.mock('@/components/notebook/YouTubeUrlInput', () => ({ default: () => null }));
vi.mock('@/components/notebook/CopiedTextDialog', () => ({ default: () => null }));
afterEach(cleanup);
beforeEach(() => {
  mocks.authenticated = true;
  vi.clearAllMocks();
  mocks.importTweets.mockReset().mockResolvedValue({ totalSources: 1, processed: 1, errors: [] });
});
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


const NotebookWithSourceDialog = () => {
  const [open, setOpen] = useState(true);
  return <>
    <button>Existing notebook source</button>
    <AddSourcesDialog open={open} onOpenChange={setOpen} notebookId="owned-notebook" />
  </>;
};

const openBookmarkImport = async (kind: 'urls' | 'archive') => {
  render(<NotebookWithSourceDialog />);
  await userEvent.click(screen.getByRole('button', { name: /Bookmarks & Tweets/ }));
  if (kind === 'archive') {
    await userEvent.click(screen.getByRole('tab', { name: 'Twitter Archive JS/JSON' }));
    fireEvent.change(screen.getByLabelText('Upload Bookmarks Export File'), {
      target: { files: [new File(['[{"tweetId":"123"}]'], 'bookmarks.json', { type: 'application/json' })] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import Archive' })).toBeEnabled());
  } else {
    fireEvent.change(screen.getByLabelText('Paste X / Twitter URL(s)'), {
      target: { value: 'https://x.com/cedar/status/123' },
    });
  }
  return screen.getByRole('button', { name: kind === 'archive' ? 'Import Archive' : 'Import 1 Tweet' });
};

describe('bookmark import returns to the notebook', () => {
  it.each(['urls', 'archive'] as const)('dismisses both source dialogs after a nonempty %s import', async (kind) => {
    const submit = await openBookmarkImport(kind);
    expect(screen.queryByRole('button', { name: 'Existing notebook source' })).not.toBeInTheDocument();
    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByText('Add sources')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Existing notebook source' })).toBeVisible();
    expect(mocks.importTweets).toHaveBeenCalledOnce();
  });

  it.each(['urls', 'archive'] as const)('keeps the %s editor and its input when no sources were imported', async (kind) => {
    mocks.importTweets.mockResolvedValue({ totalSources: 0, processed: 0, errors: ['Tweet could not be extracted'] });
    await userEvent.click(await openBookmarkImport(kind));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Import failed', description: 'Tweet could not be extracted', variant: 'destructive',
    })));
    expect(screen.getByRole('dialog', { name: 'Import Bookmarks & Tweet Seeds' })).toBeVisible();
    expect(screen.getByText('Add sources')).toBeInTheDocument();
    if (kind === 'urls') expect(screen.getByLabelText('Paste X / Twitter URL(s)')).toHaveValue('https://x.com/cedar/status/123');
    else expect(screen.getByText('bookmarks.json')).toBeVisible();
    expect(screen.getByRole('button', { name: kind === 'archive' ? 'Import Archive' : 'Import 1 Tweet' })).toBeEnabled();
  });

  it('preserves a failed request for retry and returns only to Add sources on cancel', async () => {
    mocks.importTweets.mockRejectedValue(new Error('Network unavailable'));
    await userEvent.click(await openBookmarkImport('urls'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Import failed', description: 'Network unavailable', variant: 'destructive',
    })));
    expect(screen.getByLabelText('Paste X / Twitter URL(s)')).toHaveValue('https://x.com/cedar/status/123');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Add sources' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Import Bookmarks & Tweet Seeds' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Existing notebook source' })).not.toBeInTheDocument();
  });
});
