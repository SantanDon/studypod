/** Recovery hints only: never store extracted content, file bytes or session data. */
export const UPLOAD_INTERRUPTION_REASON = "Upload interrupted before its save was confirmed. Once the connection is restored, remove this source and add the original file again.";
export const GUEST_UPLOAD_INTERRUPTION_REASON = "Upload interrupted before completion. Remove this source and add the original file again.";
export type UploadInterruptionStage = "uploading" | "saving" | "processing";
export interface UploadInterruptionScope { ownerId: string; notebookId: string; kind?: "authenticated" | "guest" }
export interface UploadInterruption {
  sourceId: string;
  fileName: string;
  stage: UploadInterruptionStage;
  occurredAt: string;
  reason: typeof UPLOAD_INTERRUPTION_REASON | typeof GUEST_UPLOAD_INTERRUPTION_REASON;
}
const prefix = "studypod:upload-interruption:v1:";
const guestPrefix = "studypod:guest-upload-interruption:v1:";
const listeners = new Set<() => void>();
// Only this document knows it still holds the original File and upload queue.
// This is deliberately not persisted: a fresh document must expose recovery.
const activeUploads = new Set<string>();
/** Only a boolean leaves this module; no account, filename or receipt is exposed. */
export const hasActiveSourceUploads = (): boolean => activeUploads.size > 0;
const keyFor = (scope: UploadInterruptionScope) => `${scope.kind === "guest" ? guestPrefix : prefix}${encodeURIComponent(scope.ownerId)}:${encodeURIComponent(scope.notebookId)}`;
const activeKey = (scope: UploadInterruptionScope, sourceId: string) => JSON.stringify([scope.kind || "authenticated", scope.ownerId, scope.notebookId, sourceId]);
const reasonFor = (scope: UploadInterruptionScope) => scope.kind === "guest" ? GUEST_UPLOAD_INTERRUPTION_REASON : UPLOAD_INTERRUPTION_REASON;
const validScope = (scope: UploadInterruptionScope) => !!scope.ownerId && !!scope.notebookId;
const notify = () => listeners.forEach(listener => listener());

export class SourceSaveError extends Error {
  readonly code = "SOURCE_SAVE_FAILED";
  readonly stage = "saving";
  constructor() {
    super("Extracted text could not be saved to your notebook. Restore the connection, remove this source and add the original file again.");
    this.name = "SourceSaveError";
  }
}

export function readUploadInterruptions(scope: UploadInterruptionScope): UploadInterruption[] {
  if (!validScope(scope)) return [];
  try {
    const values: unknown = JSON.parse(localStorage.getItem(keyFor(scope)) || "[]");
    if (!Array.isArray(values)) return [];
    return values.slice(-100).flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Record<string, unknown>;
      if (typeof entry.sourceId !== "string" || !entry.sourceId || entry.sourceId.length > 200 ||
          typeof entry.fileName !== "string" || entry.fileName.length > 255 ||
          typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt)) ||
          !["uploading", "saving", "processing"].includes(String(entry.stage))) return [];
      return [{ sourceId: entry.sourceId, fileName: entry.fileName,
        stage: entry.stage as UploadInterruptionStage, occurredAt: entry.occurredAt,
        reason: reasonFor(scope) }];
    });
  } catch { return []; }
}

export function recordUploadInterruption(scope: UploadInterruptionScope, input: Pick<UploadInterruption, "sourceId" | "fileName" | "stage">): void {
  activeUploads.delete(activeKey(scope, input.sourceId));
  writeUploadReceipt(scope, input);
}

/** Call immediately after acknowledged creation, before starting or queuing extraction. */
export function beginSourceUpload(scope: UploadInterruptionScope, input: Pick<UploadInterruption, "sourceId" | "fileName" | "stage">): void {
  if (!validScope(scope) || !input.sourceId) return;
  activeUploads.add(activeKey(scope, input.sourceId));
  writeUploadReceipt(scope, input);
}

export function readRecoverableUploadInterruptions(scope: UploadInterruptionScope): UploadInterruption[] {
  return readUploadInterruptions(scope).filter(entry => !activeUploads.has(activeKey(scope, entry.sourceId)));
}

function writeUploadReceipt(scope: UploadInterruptionScope, input: Pick<UploadInterruption, "sourceId" | "fileName" | "stage">): void {
  if (!validScope(scope) || !input.sourceId) return;
  const receipt: UploadInterruption = {
    sourceId: input.sourceId.slice(0, 200), fileName: input.fileName.slice(0, 255),
    stage: input.stage, occurredAt: new Date().toISOString(), reason: reasonFor(scope),
  };
  try {
    const entries = readUploadInterruptions(scope).filter(entry => entry.sourceId !== receipt.sourceId);
    localStorage.setItem(keyFor(scope), JSON.stringify([...entries, receipt].slice(-100)));
  } catch { /* Storage may be unavailable; never replace the original upload error. */ }
  notify();
}

export function clearUploadInterruption(scope: UploadInterruptionScope, sourceId: string): void {
  if (!validScope(scope)) return;
  // Acknowledged completion ends live work even if receipt storage is unavailable.
  activeUploads.delete(activeKey(scope, sourceId));
  try {
    const entries = readUploadInterruptions(scope);
    const retained = entries.filter(entry => entry.sourceId !== sourceId);
    if (retained.length === entries.length) return;
    if (retained.length) localStorage.setItem(keyFor(scope), JSON.stringify(retained));
    else localStorage.removeItem(keyFor(scope));
  } catch { /* Recovery UI must still work when browser storage is blocked. */ }
  finally { notify(); }
}

/** Local sources have no user_id; their owning notebook must be verified instead. */
export function ownsUploadInterruptionSource(scope: UploadInterruptionScope, source: {
  notebook_id: string; user_id?: string;
}, localNotebook?: { id: string; user_id: string } | null): boolean {
  if (source.notebook_id !== scope.notebookId) return false;
  return scope.kind === "guest"
    ? localNotebook?.id === scope.notebookId && localNotebook.user_id === scope.ownerId
    : source.user_id === scope.ownerId;
}

export function reconcileUploadInterruptions(scope: UploadInterruptionScope, sources: ReadonlyArray<{
  id: string; user_id?: string; notebook_id: string; processing_status?: string;
}>, localNotebook?: { id: string; user_id: string } | null): void {
  // Absence, pending and processing cannot prove completion, especially while offline.
  for (const source of sources) {
    if (ownsUploadInterruptionSource(scope, source, localNotebook) &&
        ["completed", "ready", "degraded", "failed", "cancelled"].includes(source.processing_status || "")) {
      clearUploadInterruption(scope, source.id);
    }
  }
}

export function subscribeUploadInterruptions(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix) || event.key.startsWith(guestPrefix)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
