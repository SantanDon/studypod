import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddSourcesDialog from '@/components/notebook/AddSourcesDialog';

const state = vi.hoisted(() => ({ isGuest: true, canAddSource: false, sourcesRemaining: 0, prompt: vi.fn() }));
vi.mock('@/hooks/useGuest', () => ({
  useGuest: () => ({ isGuest: state.isGuest, showAuthPrompt: state.prompt }),
  useNotebookLimits: () => ({ canAddSource: state.canAddSource, sourcesRemaining: state.sourcesRemaining }),
}));
vi.mock('@/components/notebook/hooks/useAddSourcesHandlers', () => ({ useAddSourcesHandlers: () => ({
  handleMultipleWebsiteSubmit: vi.fn(), handleYouTubeSubmit: vi.fn(), handleDrag: vi.fn(), handleDrop: vi.fn(), handleFileSelect: vi.fn(),
  dragActive: false, isProcessingFiles: false, pendingFileNames: [],
}) }));
vi.mock('@/components/notebook/MultipleWebsiteUrlsDialog', () => ({ default: () => null }));
vi.mock('@/components/notebook/YouTubeUrlInput', () => ({ default: () => null }));
vi.mock('@/components/notebook/BookmarkImportDialog', () => ({ default: () => null }));
vi.mock('@/components/notebook/CopiedTextDialog', () => ({ default: () => <div>Pasted source editor</div> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { state.isGuest = true; state.canAddSource = false; state.sourcesRemaining = 0; state.prompt.mockClear(); });
const open = () => render(<AddSourcesDialog open onOpenChange={vi.fn()} notebookId="test-notebook" />);

describe('source entry allowance', () => {
  it('explains an exhausted guest quota and prompts before opening a file chooser or editor', () => {
    open();
    const picker = vi.spyOn(document.querySelector('input[type=file]') as HTMLInputElement, 'click');
    expect(screen.getByText(/reached its source limit/)).toBeVisible();
    expect(screen.getByText('Guest source limit reached')).toBeVisible();
    expect(document.querySelector('input[type=file]')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Browse files' })).not.toBeInTheDocument();
    // Recovery must remain outside the disabled upload surface for assistive
    // technology and real browser clicks, which honor inherited aria-disabled.
    expect(screen.getByRole('button', { name: 'Sign in to add sources', exact: true }).closest('[aria-disabled="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to add sources', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /Pasted Content/ }));
    expect(picker).not.toHaveBeenCalled();
    expect(screen.queryByText('Pasted source editor')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload source files' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Upload source files' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Upload source files' }), { key: 'Enter' });
    expect(picker).not.toHaveBeenCalled();
    for (const name of [/Pasted Content/, /Website/, /YouTube/, /Bookmark/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(state.prompt).toHaveBeenCalledOnce();
  });
  it('restores source controls when deleting a source releases a guest slot', () => {
    const view = open();
    expect(screen.getByRole('button', { name: /Pasted Content/ })).toBeDisabled();
    state.canAddSource = true;
    state.sourcesRemaining = 1;
    view.rerender(<AddSourcesDialog open onOpenChange={vi.fn()} notebookId="test-notebook" />);
    expect(screen.getByRole('button', { name: 'Upload source files' })).toHaveAttribute('aria-disabled', 'false');
    expect(document.querySelector('input[type=file]')).toBeEnabled();
    const picker = vi.spyOn(document.querySelector('input[type=file]') as HTMLInputElement, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));
    expect(picker).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Pasted Content/ }));
    expect(screen.getByText('Pasted source editor')).toBeVisible();
    expect(state.prompt).not.toHaveBeenCalled();
  });
  it.each([true, false])('opens the chooser when permitted (guest=%s)', (isGuest) => {
    state.isGuest = isGuest;
    state.canAddSource = isGuest;
    state.sourcesRemaining = 1;
    open();
    const picker = vi.spyOn(document.querySelector('input[type=file]') as HTMLInputElement, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));
    expect(picker).toHaveBeenCalledOnce();
    expect(state.prompt).not.toHaveBeenCalled();
    expect(screen.getByText(isGuest ? /1 more source to this guest notebook/ : /Choose up to 20 files/)).toBeVisible();
  });
});
