import { hasActiveSourceUploads } from '@/lib/sources/sourceUploadInterruption';

/** Match browser/bundler module failures, not a generic API or network error. */
export function isModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Loading chunk \S+ failed/i.test(error.message);
}

/** Recheck at click time: a reload discards original Files held by this document. */
export function reloadAfterModuleFailure(reload: () => void = () => window.location.reload()): boolean {
  if (hasActiveSourceUploads()) return false;
  reload();
  return true;
}
