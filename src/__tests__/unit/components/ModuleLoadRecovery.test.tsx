import { lazy, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '@/components/ErrorBoundary';
import ErrorFallback from '@/components/ErrorFallback';
import { isModuleLoadError, reloadAfterModuleFailure } from '@/lib/moduleLoadRecovery';
import { beginSourceUpload, clearUploadInterruption, hasActiveSourceUploads, recordUploadInterruption } from '@/lib/sources/sourceUploadInterruption';

vi.mock('@/lib/moduleLoadRecovery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/moduleLoadRecovery')>(),
  reloadAfterModuleFailure: vi.fn(),
}));
const scope = { ownerId: 'synthetic-owner', notebookId: 'synthetic-notebook' };
const upload = { sourceId: 'synthetic-source', fileName: 'cedar.txt', stage: 'uploading' as const };
afterEach(() => { cleanup(); clearUploadInterruption(scope, upload.sourceId); localStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const show = (error: Error) => render(<MemoryRouter><ErrorFallback error={error} resetError={vi.fn()} /></MemoryRouter>);

describe('recovering an unavailable application module', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/Notebook-synthetic.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Failed to load module script: Expected a JavaScript module script',
    'Loading chunk 5 failed.',
  ])('recognizes module-specific failure: %s', (message) => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true);
  });
  it('keeps ordinary API, extraction and rendering failures on the existing retry path', () => {
    for (const message of ['Failed to fetch', 'SOURCE_SAVE_FAILED', 'NetworkError', 'Cannot read properties of undefined']) {
      expect(isModuleLoadError(new Error(message))).toBe(false);
    }
    show(new Error('Failed to fetch'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reload StudyPod' })).toBeNull();
  });
  it('shows a rejected real React.lazy import as explicit manual recovery without an automatic reload or cached retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'group').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const onReset = vi.fn();
    const Missing = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/synthetic.js')));
    render(<MemoryRouter><ErrorBoundary onReset={onReset} title="Custom generic title"><Suspense fallback="Loading"><Missing /></Suspense></ErrorBoundary></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Part of StudyPod could not load');
    expect(screen.queryByRole('button', { name: /Retry|Try Again/ })).toBeNull();
    expect(reloadAfterModuleFailure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload StudyPod' }));
    expect(reloadAfterModuleFailure).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByText(/update is available/i)).toBeNull();
  });
  it('blocks reload during live queued uploads and updates after acknowledged completion even if storage fails', () => {
    beginSourceUpload(scope, upload);
    show(new Error('Importing a module script failed.'));
    expect(screen.getByRole('button', { name: 'Reload StudyPod' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('original files are preserved');
    fireEvent.click(screen.getByRole('button', { name: 'Reload StudyPod' }));
    expect(reloadAfterModuleFailure).not.toHaveBeenCalled();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    act(() => clearUploadInterruption(scope, upload.sourceId));
    expect(hasActiveSourceUploads()).toBe(false);
    expect(screen.getByRole('button', { name: 'Reload StudyPod' })).toBeEnabled();
  });
  it('rechecks live uploads at click time and permits recovery after an interruption without clearing its receipt', async () => {
    const actual = await vi.importActual<typeof import('@/lib/moduleLoadRecovery')>('@/lib/moduleLoadRecovery');
    const reload = vi.fn();
    beginSourceUpload(scope, upload);
    expect(actual.reloadAfterModuleFailure(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    recordUploadInterruption(scope, upload);
    const receipt = localStorage.getItem(localStorage.key(0)!);
    expect(actual.reloadAfterModuleFailure(reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem(localStorage.key(0)!)).toBe(receipt);
  });
});
