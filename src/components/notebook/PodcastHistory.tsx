import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faTrash,
  faDownload,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import type { PodcastRecord } from "@/services/podcastApiService";
import type { Source } from "@/hooks/useSources";
import { getSourceProcessingStatus, isSourceUsableForGroundedWork } from "@/lib/sources/sourceProcessing";
import { format } from "date-fns";
import { usePodcastHistory } from "@/hooks/usePodcastHistory";
import {
  getResumableTime,
  loadPlaybackCheckpoint,
} from "@/lib/audio/playbackProgress";
import { useToast } from "@/hooks/use-toast";

interface PodcastHistoryProps {
  notebookId: string;
  onPlay: (audioUrl: string, title: string, podcastId: string) => void;
  onDeleted?: (podcastId: string) => void;
  currentAudioUrl?: string | null;
  currentPodcastId?: string | null;
  sources: Source[];
  sourcesLoading: boolean;
  sourcesError: Error | null;
  sourcesFetching: boolean;
  retrySources: () => void;
  onOpenSource?: (source: Source) => void;
}

const formatResumeTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
};

export const PodcastHistory: React.FC<PodcastHistoryProps> = ({
  notebookId,
  onPlay,
  onDeleted,
  currentPodcastId,
  sources,
  sourcesLoading,
  sourcesError,
  sourcesFetching,
  retrySources,
  onOpenSource,
}) => {
  const { podcasts, isLoading, deletePodcast, isDeleting, loadAudio, loadError, mutationError, retryHistory, isRefreshing } =
    usePodcastHistory(notebookId);
  const { toast } = useToast();
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const handlePlay = async (podcast: PodcastRecord) => {
    try {
      setLoadingAudioId(podcast.id);
      const blob = await loadAudio(podcast);

      if (blob) {
        const url = URL.createObjectURL(blob);
        onPlay(url, podcast.title, podcast.id);
      } else {
        toast({
          title: "Episode unavailable",
          description:
            "The saved audio file is missing. You can remove this history entry and generate it again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading audio:", error);
      toast({
        title: "Could not open episode",
        description: "StudyPod could not load this saved audio file.",
        variant: "destructive",
      });
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleDownload = async (podcast: PodcastRecord) => {
    try {
      const blob = await loadAudio(podcast);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${podcast.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Error downloading audio:", error);
      toast({ title: 'Could not download episode', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' });
    }
  };

  const handleDelete = async (podcast: PodcastRecord) => {
    if (confirm("Are you sure you want to delete this podcast?")) {
      try { await deletePodcast(podcast); onDeleted?.(podcast.id); } catch (error) { toast({ title: 'Could not delete episode', description: error instanceof Error ? error.message : 'Please retry.', variant: 'destructive' }); }
    }
  };

  const historyError = loadError || mutationError;
  const errorNotice = historyError ? <div role="alert" className="mb-3 text-sm text-red-600">{historyError instanceof Error ? historyError.message : 'Could not load saved episodes. Please retry.'}{loadError && <button type="button" disabled={isRefreshing} onClick={() => void retryHistory()} className="ml-2 underline">Retry loading episodes</button>}</div> : null;
  if (isLoading) {
    return (
      <div className="text-center p-4 text-gray-500 dark:text-gray-400">
        Loading history...
      </div>
    );
  }

  if (!podcasts || podcasts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-[#faf8f3] p-5 text-center text-stone-600 dark:border-border dark:bg-card dark:text-muted-foreground">
        {errorNotice}
        {!loadError && <p className="text-sm">No saved episodes yet.</p>}
      </div>
    );
  }

  return (
    <div>
      {errorNotice}
      <div className="space-y-3">
        {podcasts.map((podcast, index) => {
          const checkpoint = loadPlaybackCheckpoint(podcast.id);
          const resumeAt = getResumableTime(checkpoint, podcast.duration);
          const progress =
            podcast.duration && resumeAt > 0
              ? Math.min(100, Math.max(0, (resumeAt / podcast.duration) * 100))
              : 0;
          const isCurrent = currentPodcastId === podcast.id;

          return (
            <div
              key={podcast.id}
              className={`group rounded-xl border p-3 transition-colors ${
                isCurrent
                  ? "border-teal-500 bg-teal-50 dark:border-teal-600 dark:bg-teal-950/30"
                  : index === 0
                    ? "border-teal-200 bg-[#faf8f3] dark:border-teal-900 dark:bg-card"
                    : "border-stone-200 bg-white hover:bg-stone-50 dark:border-border dark:bg-card dark:hover:bg-muted"
              }`}
            >
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="min-h-11 min-w-11 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 flex items-center justify-center flex-shrink-0">
                  {loadingAudioId === podcast.id ? (
                    <FontAwesomeIcon
                      icon={faSpinner}
                      spin
                      className="text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handlePlay(podcast)}
                      className="min-h-11 min-w-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                      aria-label={
                        resumeAt > 0
                          ? `Resume ${podcast.title} at ${formatResumeTime(resumeAt)}`
                          : `Play ${podcast.title}`
                      }
                    >
                      <FontAwesomeIcon
                        icon={faPlay}
                        className="text-xs ml-0.5"
                      />
                    </button>
                  )}
                </div>
                <div className="min-w-0">
                  {index === 0 && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800 dark:text-teal-300">{resumeAt > 0 ? "Continue listening" : "Latest saved audio"}</p>}
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                    {podcast.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {format(
                      new Date(podcast.created_at),
                      "MMM d, yyyy • h:mm a",
                    )}
                    {podcast.duration
                      ? ` • ${Math.max(1, Math.round(podcast.duration / 60))} min`
                      : ""}
                  </p>
                  {resumeAt > 0 && (
                    <>
                      <p className="mt-1 text-xs font-medium text-teal-800 dark:text-teal-300">
                        Resume at {formatResumeTime(resumeAt)}
                      </p>
                      <div
                        className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-teal-700"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <details className="mt-3 border-t border-stone-200 pt-2 text-sm dark:border-border">
                <summary className="min-h-11 cursor-pointer rounded-md py-2 font-medium text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-200">
                  Sources used for this audio ({podcast.source_ids?.length ?? 0})
                </summary>
                {!podcast.source_ids?.length ? (
                  <p className="pb-2 text-stone-600 dark:text-muted-foreground">This saved episode has no recorded source list.</p>
                ) : sourcesLoading ? (
                  <p role="status" className="pb-2 text-stone-600 dark:text-muted-foreground">Checking recorded sources...</p>
                ) : sourcesError ? (
                  <div role="alert" className="pb-2 text-stone-700 dark:text-foreground">
                    <p>Could not verify these recorded sources right now.</p>
                    <button type="button" onClick={retrySources} disabled={sourcesFetching} className="min-h-11 rounded-md font-medium text-teal-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50 dark:text-teal-200">
                      {sourcesFetching ? "Retrying sources..." : "Retry sources"}
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-2 pb-2">
                    {podcast.source_ids.map((sourceId, sourceIndex) => {
                      const source = sources.find((item) => item.id === sourceId && item.notebook_id === notebookId);
                      const readyNow = source ? isSourceUsableForGroundedWork(source) : false;
                      return (
                        <li key={`${sourceId}-${sourceIndex}`} className="min-w-0 rounded-lg bg-white/70 px-3 py-2 dark:bg-background/50">
                          {source ? (
                            <>
                              <p className="break-words font-medium text-stone-900 dark:text-foreground">{source.title}</p>
                              <p className="text-xs text-stone-600 dark:text-muted-foreground">
                                {readyNow ? "Ready now" : `Current status: ${getSourceProcessingStatus(source)}. This does not change which source was recorded for the episode.`}
                              </p>
                              {onOpenSource && (
                                <button type="button" onClick={() => onOpenSource(source)} className="min-h-11 rounded-md text-left font-medium text-teal-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-200">
                                  View {source.title} in Sources
                                </button>
                              )}
                            </>
                          ) : (
                            <p className="break-all text-stone-600 dark:text-muted-foreground">Recorded source {sourceIndex + 1} is no longer in this notebook.</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </details>

              <div className="flex items-center space-x-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button
                  onClick={() => handleDownload(podcast)}
                  className="min-h-11 min-w-11 p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors"
                  aria-label={`Download ${podcast.title}`}
                  title="Download"
                >
                  <FontAwesomeIcon icon={faDownload} className="text-xs" />
                </button>
                <button
                  onClick={() => handleDelete(podcast)}
                  disabled={isDeleting}
                  className="min-h-11 min-w-11 p-2 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  aria-label={`Delete ${podcast.title}`}
                  title="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} className="text-xs" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
