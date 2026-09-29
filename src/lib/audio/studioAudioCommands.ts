import { create } from 'zustand';
export type StudioAudioKind = 'audiobook' | 'podcast';
export type StudioAudioOperation = 'generate' | 'resume' | 'status' | 'cancel' | 'open';
export interface StudioAudioIntent {
    kind: StudioAudioKind;
    operation: StudioAudioOperation;
    message: string;
    focus?: string;
    chapterSelection?: boolean;
}
export interface StudioAudioRequest extends StudioAudioIntent {
    id: string;
    notebookId: string;
    sourceIds: string[];
    phase: 'draft' | 'queued' | 'executing' | 'accepted' | 'failed';
    queuedAt?: number;
    result?: string;
}
export const OPEN_STUDIO_AUDIO_EVENT = 'studypod:open-studio-audio';
/** Only explicit user commands are offered as actions. Never run document text or an AI reply. */
export function parseStudioAudioIntent(input: string): StudioAudioIntent | null {
    const message = input.trim();
    if (!message || message.length > 1000 || /\b(?:do not|don't|never|do not ever)\b/i.test(message))
        return null;
    const statusMatch = /^(?:what(?:'s| is)|how is) (?:the )?(?:status|progress) of (?:my |the )?(podcast|audiobook)\??$/i.exec(message);
    if (statusMatch)
        return { kind: statusMatch[1].toLowerCase() === 'podcast' ? 'podcast' : 'audiobook', operation: 'status', message };
    const text = message.replace(/^(?:(?:can|could|would) you\s+(?:please\s+)?|please\s+)/i, '');
    if (!/^(?:make|create|generate|turn|convert|read|narrate|resume|continue|retry|cancel|stop|open|show|check|download)\b/i.test(text))
        return null;
    const podcast = /\bpodcast\b/i.test(text);
    const audiobook = /\baudio\s?book\b|\bread[- ]aloud\b|\baloud\b|^narrate\b/i.test(text);
    if (podcast === audiobook)
        return null; // Both/neither need an ordinary clarification.
    let operation: StudioAudioOperation = /^(?:resume|continue|retry)\b/i.test(text) ? 'resume'
        : /^(?:cancel|stop)\b/i.test(text) ? 'cancel'
            : /^(?:check|show)\b.*\b(?:status|progress)\b/i.test(text) ? 'status'
                : /^(?:open|show|download)\b/i.test(text) ? 'open' : 'generate';
    const chapterSelection = audiobook && /\b(?:chapter|section|pages?)\s+(?:\d|[ivxlcdm]+\b|one\b|two\b|three\b)/i.test(text);
    if (chapterSelection && operation === 'generate')
        operation = 'open';
    const focus = podcast ? text.match(/\b(?:about|focusing on|focus on)\s+(.+?)[.!?]*$/i)?.[1]?.trim() : undefined;
    return { kind: podcast ? 'podcast' : 'audiobook', operation, message, focus, chapterSelection };
}
export function hasNarrationManifest(source: {
    metadata?: unknown;
}): boolean {
    try {
        const metadata = typeof source.metadata === 'string' ? JSON.parse(source.metadata) : source.metadata;
        if (!metadata || typeof metadata !== 'object')
            return false;
        const data = metadata as {
            fileName?: unknown;
            chapters?: unknown;
        };
        return typeof data.fileName === 'string' && Boolean(data.fileName.trim()) && Array.isArray(data.chapters) && data.chapters.length > 0;
    }
    catch {
        return false;
    }
}
interface AudioCommandStore {
    requests: Record<string, StudioAudioRequest>;
    draft: (notebookId: string, intent: StudioAudioIntent, sourceId?: string | null) => boolean;
    queue: (notebookId: string, id: string, sourceIds: string[]) => boolean;
    claim: (notebookId: string, kind: StudioAudioKind) => StudioAudioRequest | null;
    finish: (notebookId: string, id: string, ok: boolean, result: string) => void;
    dismiss: (notebookId: string, id: string) => void;
}
// Deliberately memory-only: a reload must never replay an unconfirmed generation request.
// The existing audio job/artifact stores own durable audio state, not this UI command bridge.
export const useStudioAudioCommands = create<AudioCommandStore>((set, get) => ({
    requests: {},
    draft: (notebookId, intent, sourceId) => {
        if (!notebookId)
            return false;
        const previous = get().requests[notebookId];
        const cancellingOwnPodcast = intent.kind === 'podcast' && intent.operation === 'cancel' && previous?.kind === 'podcast';
        if (previous && ['queued', 'executing'].includes(previous.phase) && !cancellingOwnPodcast)
            return false;
        const request: StudioAudioRequest = { ...intent, id: crypto.randomUUID(), notebookId, sourceIds: sourceId ? [sourceId] : [], phase: 'draft' };
        set((state) => ({ requests: { ...state.requests, [notebookId]: request } }));
        return true;
    },
    queue: (notebookId, id, sourceIds) => {
        const request = get().requests[notebookId];
        if (!request || request.id !== id || request.phase !== 'draft')
            return false;
        if (sourceIds.some((sourceId) => typeof sourceId !== 'string' || !sourceId.trim()))
            return false;
        if (['generate', 'resume'].includes(request.operation) && sourceIds.length === 0)
            return false;
        set((state) => ({ requests: { ...state.requests, [notebookId]: { ...request, sourceIds: [...new Set(sourceIds)], phase: 'queued', queuedAt: Date.now() } } }));
        if (typeof window !== 'undefined')
            window.dispatchEvent(new CustomEvent(OPEN_STUDIO_AUDIO_EVENT, { detail: { notebookId, kind: request.kind } }));
        return true;
    },
    claim: (notebookId, kind) => {
        const request = get().requests[notebookId];
        if (!request || request.kind !== kind || request.phase !== 'queued')
            return null;
        if (!request.queuedAt || Date.now() - request.queuedAt > 60000) {
            set((state) => ({ requests: { ...state.requests, [notebookId]: { ...request, phase: 'failed', result: 'This command expired before Studio opened. Confirm a new request.' } } }));
            return null;
        }
        set((state) => ({ requests: { ...state.requests, [notebookId]: { ...request, phase: 'executing' } } }));
        return request;
    },
    finish: (notebookId, id, ok, result) => {
        const request = get().requests[notebookId];
        if (!request || request.id !== id || request.phase !== 'executing')
            return;
        set((state) => ({ requests: { ...state.requests, [notebookId]: { ...request, phase: ok ? 'accepted' : 'failed', result } } }));
    },
    dismiss: (notebookId, id) => {
        const request = get().requests[notebookId];
        if (!request || request.id !== id || request.phase === 'executing')
            return;
        set((state) => { const requests = { ...state.requests }; delete requests[notebookId]; return { requests }; });
    },
}));
