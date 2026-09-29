import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Source } from '@/types/domain/Source';
import { isSourceUsableForGroundedWork } from '@/lib/sources/sourceProcessing';
import { hasNarrationManifest, useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import { useAudiobookStore } from '@/stores/audiobookStore';
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
export default function StudioAudioCommandCard({ notebookId, sources }: {
    notebookId: string;
    sources: Source[];
}) {
    const request = useStudioAudioCommands((state) => state.requests[notebookId]);
    const [selection, setSelection] = useState('');
    const bookJob = useAudiobookStore((state) => request?.sourceIds[0] ? state.jobs[request.sourceIds[0]] : undefined);
    const podcast = usePodcastGenerationStore();
    const eligible = sources.filter((source) => request?.kind === 'audiobook' ? hasNarrationManifest(source) : isSourceUsableForGroundedWork(source));
    const sourceSignature = eligible.map((source) => source.id).join('|');
    useEffect(() => {
        const selected = request?.sourceIds[0];
        const ids = sourceSignature ? sourceSignature.split('|') : [];
        setSelection(selected && ids.includes(selected) ? selected : ids.length === 1 ? ids[0] : '');
    }, [request?.id, sourceSignature, request?.sourceIds]);
    if (!request)
        return null;
    const busy = request.phase === 'queued' || request.phase === 'executing';
    // An audiobook command addresses one specific book. Status, cancel, generate and
    // resume all need the source chosen explicitly so an ambiguous command can never
    // act on whichever book happens to be open.
    const requiresSource = ['generate', 'resume'].includes(request.operation) || (request.kind === 'audiobook' && ['status', 'cancel'].includes(request.operation));
    const singleBookOnly = request.kind === 'audiobook' && ['generate', 'resume', 'cancel', 'status'].includes(request.operation);
    const chosenIds = selection === '*' ? eligible.map((source) => source.id) : eligible.filter((source) => source.id === selection).map((source) => source.id);
    const activeBook = bookJob?.notebookId === notebookId ? bookJob : undefined;
    const activePodcast = request.kind === 'podcast' && podcast.notebookId === notebookId;
    const queuedAction = () => useStudioAudioCommands.getState().queue(notebookId, request.id, chosenIds);
    const openStudio = () => {
        const store = useStudioAudioCommands.getState();
        if (store.draft(notebookId, { ...request, operation: 'open', message: `Open ${request.kind} in Studio` }, chosenIds[0])) {
            store.queue(notebookId, useStudioAudioCommands.getState().requests[notebookId].id, chosenIds);
        }
    };
    const title = request.kind === 'audiobook' ? 'Read aloud' : 'Podcast';
    return (<section aria-label="Chat audio action" className="mx-4 mb-3 max-h-72 overflow-y-auto rounded-xl border border-border bg-muted/40 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold">{title}</p><p className="mt-1 break-words text-muted-foreground">{request.message}</p></div>
        <Button size="sm" variant="ghost" disabled={request.phase === 'executing'} onClick={() => useStudioAudioCommands.getState().dismiss(notebookId, request.id)}>Dismiss</Button>
      </div>
      {request.phase === 'draft' && <div className="mt-3 space-y-3">
        {requiresSource && <label className="block space-y-1"><span>Source for this audio</span>
          <select aria-label="Source for this audio" value={selection} onChange={(event) => setSelection(event.target.value)} className="w-full rounded-md border border-input bg-background p-2 text-foreground">
            <option value="">Choose a source</option>
            {request.kind === 'podcast' && eligible.length > 1 && <option value="*">All ready sources in this notebook</option>}
            {eligible.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
          </select>
        </label>}
        {request.kind === 'audiobook' && requiresSource && <p className="text-xs text-muted-foreground">Full narration uses the original book's chapter manifest, not a chat summary. A PDF or document without that manifest must first be imported through Audiobook Studio.</p>}
        {request.kind === 'audiobook' && singleBookOnly && <p className="text-xs text-muted-foreground">Choose exactly one book above. {request.operation === 'cancel' ? 'Cancelling without a chosen book is refused so the wrong job is never stopped.' : 'This command applies to that one book only.'}</p>}
        {request.kind === 'podcast' && requiresSource && <p className="text-xs text-muted-foreground">A source-grounded discussion, not verbatim narration. Uses your Studio voices and episode settings.{request.focus ? ` Focus: ${request.focus}` : ''}</p>}
        {request.chapterSelection && <p className="text-xs text-muted-foreground">Choose the requested chapter in Studio. This command will not start full-book narration.</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={queuedAction} disabled={singleBookOnly ? chosenIds.length !== 1 : requiresSource && chosenIds.length === 0}>
          {request.operation === 'generate' ? 'Confirm generation' : request.operation === 'resume' ? 'Confirm retry / resume' : request.operation === 'cancel' ? 'Cancel generation' : request.operation === 'status' ? 'Check audio status' : 'Open in Studio'}
        </Button>{requiresSource && eligible.length === 0 && <Button size="sm" variant="outline" onClick={openStudio}>Open audio import</Button>}</div>
      </div>}
      <p aria-live="polite" className={`mt-2 ${request.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {request.phase === 'queued' ? 'Opening the matching Studio tool. Generation has not started yet.' : request.phase === 'executing' ? 'Studio is checking this request...' : request.result}
      </p>
      {request.phase === 'accepted' && request.kind === 'audiobook' && activeBook && <div className="mt-2 space-y-1">
        <p>{activeBook.bookTitle}: {activeBook.status} · {activeBook.completedChapters || 0}/{activeBook.chapterCount || '?'} chapters</p>
        <progress aria-label="Audiobook progress" className="w-full" max={100} value={activeBook.progress || 0}/>
      </div>}
      {request.phase === 'accepted' && activePodcast && <div className="mt-2 space-y-1">
        <p>{podcast.progress?.message || (podcast.audioUrl ? 'Playback available in Studio.' : 'Preparing podcast.')}</p>
        {podcast.isGenerating && <progress aria-label="Podcast progress" className="w-full" max={100} value={podcast.progress?.percentage || 0}/>}
        {podcast.audioUrl?.startsWith('blob:') && <audio aria-label="Generated podcast" controls preload="metadata" src={podcast.audioUrl} className="w-full"/>}
      </div>}
      {!busy && request.phase !== 'draft' && <Button size="sm" variant="outline" className="mt-2" onClick={openStudio}>Open playback, chapters and download</Button>}
    </section>);
}
