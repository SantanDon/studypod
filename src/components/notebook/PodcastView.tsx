import { useStudioAudioCommands } from '@/lib/audio/studioAudioCommands';
import React, { useState, useEffect, useCallback, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faPlay,
  faArrowsRotate,
  faGear,
  faXmark,
  faMinimize,
  faExpand,
  faClock,
  faKeyboard,
  faHourglassHalf,
  faFlask,
} from "@fortawesome/free-solid-svg-icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSources } from "@/hooks/useSources";
import { generatePodcastScript } from "@/lib/podcastGenerator";
import { buildPodcastEvidenceContext } from "@/lib/podcastGenerator";
import { useToast } from "@/hooks/use-toast";
import TTSProviderSettings from "./TTSProviderSettings";
import TTSSettingsDialog from "./TTSSettingsDialog";
import {
  usePodcastGenerationStore,
  usePodcastIsGenerating,
  usePodcastProgress,
  usePodcastScript,
  usePodcastAudioUrl,
  usePodcastId,
} from "@/stores/podcastGenerationStore";
import {
  getPodcastAudioConfig,
  savePodcastAudioConfig,
} from "@/lib/tts/podcastAudioGenerator";
import { KOKORO_VOICES } from "@/lib/tts/kokoroTTSProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getStreamingTTSGenerator,
  StreamingProgress,
  StreamingResult,
} from "@/lib/tts/streamingTTSGenerator";
import {
  AudioValidator,
  AudioValidationResult,
} from "@/lib/tts/audioValidator";
import AudioPlayer from "./AudioPlayer";
import "./PodcastView.css";
import { PodcastHistory } from "./PodcastHistory";
import { usePodcastHistory } from "@/hooks/usePodcastHistory";
import { useNotes } from "@/hooks/useNotes";
import {
  clearPlaybackCheckpoint,
  getResumableTime,
  loadPlaybackCheckpoint,
} from "@/lib/audio/playbackProgress";
import type { PodcastSave } from '@/services/podcastApiService';
import type { Citation } from "@/types/message";
import type { Source } from "@/hooks/useSources";
import { isSourceUsableForGroundedWork } from "@/lib/sources/sourceProcessing";

let podcastPreparation: { notebookId: string; cancelled: boolean } | null = null;

interface PodcastViewProps {
  notebookId?: string;
  onOpenSource?: (citation: Citation) => void;
}

const PodcastView: React.FC<PodcastViewProps> = ({ notebookId, onOpenSource }) => {
  const safeNotebookId = notebookId || "";
  const audioCommand = useStudioAudioCommands((state) => state.requests[safeNotebookId]);
  const { sources, isLoading: sourcesLoading, isFetching: sourcesFetching, error: sourcesError, retrySources } = useSources(safeNotebookId);
  const openRecordedSource = (source: Source) => {
    if (!onOpenSource || source.notebook_id !== safeNotebookId) return;
    onOpenSource({
      citation_id: -1,
      source_id: source.id,
      source_title: source.title,
      source_type: source.type,
      chunk_index: 0,
      excerpt: "Full document view",
    });
  };
  const usableSources = React.useMemo(() => sources.filter(isSourceUsableForGroundedWork), [sources]);
  const skippedSourceCount = sources.length - usableSources.length;
  const sourceScopeMessage = sourcesLoading
    ? "Checking which sources are ready for audio."
    : sourcesError
      ? "Could not check source readiness. Try again when your sources load."
      : sources.length === 0
        ? "Add a source to this notebook before creating audio."
        : usableSources.length === 0
          ? "No sources are ready for audio yet. Wait for processing or add another source."
          : `Draws on excerpts from all ${usableSources.length} ready ${usableSources.length === 1 ? "source" : "sources"} in this notebook.${skippedSourceCount ? ` ${skippedSourceCount} ${skippedSourceCount === 1 ? "other source is" : "other sources are"} not ready and will be skipped.` : ""}`;
  const cannotCreateAudio = sourcesLoading || Boolean(sourcesError) || usableSources.length === 0;
  const { notes } = useNotes(safeNotebookId);
  const { toast } = useToast();

  // Store state
  const isGenerating = usePodcastIsGenerating(safeNotebookId);
  const progress = usePodcastProgress(safeNotebookId);
  const script = usePodcastScript(safeNotebookId);
  // We now use the final audio URL for playback instead of the segment sequencer
  const finalAudioUrl = usePodcastAudioUrl(safeNotebookId);
  const currentPodcastId = usePodcastId(safeNotebookId);

  const {
    startGeneration,
    updateProgress,
    setAudioReady,
    setFinalAudio,
    rehydrateState,
    cancelGeneration,
  } = usePodcastGenerationStore();

  // Local state
  const [isMinimized, setIsMinimized] = useState(false);
  const [isProviderSettingsOpen, setIsProviderSettingsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAudioLab, setShowAudioLab] = useState(false);
  const customizeAudioRef = useRef<HTMLButtonElement>(null);
  const customizeHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (showAudioLab) requestAnimationFrame(() => customizeHeadingRef.current?.focus());
  }, [showAudioLab]);
  const [isStarting, setIsStarting] = useState(false);
  const [audioValidation, setAudioValidation] =
    useState<AudioValidationResult | null>(null);
  const restoredAudioUrlRef = useRef<string | null>(null);
  const restoredAudioNotebookRef = useRef<string | null>(null);
  const restoredPodcastRef = useRef<string | null>(null);
  const requestedPodcastRef = useRef<string | null>(null);
  const requestedPodcastId = new URLSearchParams(window.location.search).get("episode");
  const finalizingScriptRef = useRef<unknown>(null);

  // Customization state
  const [host1, setHost1] = useState("Alex");
  const [host2, setHost2] = useState("Sarah");
  const [host1Voice, setHost1Voice] = useState("am_onyx");
  const [host2Voice, setHost2Voice] = useState("af_nova");
  const [podcastType, setPodcastType] = useState<
    "brief" | "standard" | "deep-dive"
  >("standard");
  const [podcastFormat, setPodcastFormat] = useState<"dialogue" | "solo">(
    "dialogue",
  );
  const [podcastFocus, setPodcastFocus] = useState("");

  const { savePodcast, podcasts, loadAudio, scopeKey, assertCurrent } = usePodcastHistory(safeNotebookId);
  const deletedPodcastRef = useRef<string | null>(null);
  useEffect(() => {
    // AudioPlayer saves its last position during effect cleanup. Clear a deleted
    // episode after that unmount commit so it cannot regain a resume checkpoint.
    if (deletedPodcastRef.current) {
      clearPlaybackCheckpoint(deletedPodcastRef.current);
      deletedPodcastRef.current = null;
    }
  }, [currentPodcastId]);
  const handleDeletedPodcast = (podcastId: string) => {
    // A completed deletion must not reset a newer episode or notebook.
    const current = usePodcastGenerationStore.getState();
    if (current.notebookId !== safeNotebookId || current.podcastId !== podcastId) return;
    if (restoredAudioUrlRef.current) {
      URL.revokeObjectURL(restoredAudioUrlRef.current);
      restoredAudioUrlRef.current = null;
      restoredAudioNotebookRef.current = null;
    }
    restoredPodcastRef.current = null;
    if (requestedPodcastRef.current === podcastId) requestedPodcastRef.current = null;
    deletedPodcastRef.current = podcastId;
    current.reset();
  };
  const generationSourcesRef = useRef(new WeakMap<object, string[]>());
  const [pendingSave, setPendingSave] = useState<{
    input: PodcastSave; url: string; scope: string; isCurrent: () => boolean; error: string;
  } | null>(null);
  const [isRetryingSave, setIsRetryingSave] = useState(false);

  const retrySave = async () => {
    if (!pendingSave || pendingSave.scope !== scopeKey || isRetryingSave) return;
    setIsRetryingSave(true);
    try {
      assertCurrent();
      if (!pendingSave.isCurrent()) throw new Error('This generation is no longer active.');
      const saved = await savePodcast(pendingSave.input);
      assertCurrent();
      if (!pendingSave.isCurrent()) return;
      setFinalAudio(pendingSave.url, safeNotebookId, saved.title, saved.id);
      setPendingSave(null);
    } catch (error) {
      setPendingSave(current => current === pendingSave ? { ...current, error: error instanceof Error ? error.message : 'Could not save this episode.' } : current);
    } finally {
      setIsRetryingSave(false);
    }
  };

  // Sync local voice choices with saved configuration on load
  useEffect(() => {
    const audioConfig = getPodcastAudioConfig();
    if (audioConfig.host1Voice) setHost1Voice(audioConfig.host1Voice);
    if (audioConfig.host2Voice) setHost2Voice(audioConfig.host2Voice);
  }, []);

  // Only stop playback on unmount, NOT generation
  // Generation continues in background via the singleton generator and global store
  useEffect(() => {
    return () => {
      const restoredUrl = restoredAudioUrlRef.current;
      if (restoredUrl) {
        // This view owns the restored blob URL. Do not leave a revoked URL in the
        // global player, or clear a newer episode/generation from another view.
        usePodcastGenerationStore.setState((state) =>
          state.notebookId === restoredAudioNotebookRef.current &&
          state.audioUrl === restoredUrl
            ? { audioUrl: null }
            : state,
        );
        URL.revokeObjectURL(restoredUrl);
        restoredAudioUrlRef.current = null;
        restoredAudioNotebookRef.current = null;
      }
      // Only stop active playback, not generation
      // The generator singleton keeps running in background
      const generator = getStreamingTTSGenerator();
      generator.stopPlayback(); // Stop playback only, not generation

      // Stop Web Speech playback only
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
    };
  }, []);

  // Auto-rehydrate active sessions on mount
  useEffect(() => {
    if (safeNotebookId && !isGenerating) {
      const rehydrated = rehydrateState(safeNotebookId);
      if (rehydrated) {
        console.info("[PodcastView] Rehydrated active podcast session");
      }
    }
  }, [safeNotebookId, isGenerating, rehydrateState]);

  // An explicit dashboard link selects its owned saved episode. Otherwise reopen the
  // most recently played unfinished episode. Both paths only prepare the player.
  useEffect(() => {
    if (!safeNotebookId || isGenerating || !podcasts?.length) return;

    const requested = requestedPodcastId
      ? podcasts.find((podcast) => podcast.id === requestedPodcastId)
      : null;
    if (requestedPodcastId && !requested) return;
    if (requested && requestedPodcastRef.current === requested.id) return;
    if (!requested && (finalAudioUrl || restoredPodcastRef.current)) return;

    const resumable = requested || podcasts
      .map((podcast) => {
        const checkpoint = loadPlaybackCheckpoint(podcast.id);
        return {
          podcast,
          checkpoint,
          resumeAt: checkpoint?.kind === "podcast"
            ? getResumableTime(checkpoint, podcast.duration)
            : 0,
        };
      })
      .filter((item) => item.resumeAt > 0 && item.checkpoint)
      .sort(
        (a, b) =>
          new Date(b.checkpoint!.updatedAt).getTime() -
          new Date(a.checkpoint!.updatedAt).getTime(),
      )[0]?.podcast;

    if (!resumable) return;

    let cancelled = false;
    let loaded = false;
    if (requested) requestedPodcastRef.current = requested.id;
    restoredPodcastRef.current = resumable.id;
    void loadAudio(resumable)
      .then((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        if (restoredAudioUrlRef.current && restoredAudioUrlRef.current !== url) {
          URL.revokeObjectURL(restoredAudioUrlRef.current);
        }
        restoredAudioUrlRef.current = url;
        restoredAudioNotebookRef.current = safeNotebookId;
        loaded = true;
        setFinalAudio(url, safeNotebookId, resumable.title, resumable.id);
      })
      .catch((error) => {
        if (cancelled) return;
        restoredPodcastRef.current = null;
        if (requested) requestedPodcastRef.current = null;
        if (requested) {
          toast({
            title: "Could not open saved episode",
            description: error instanceof Error ? error.message : "Try opening it from saved audio overviews.",
            variant: "destructive",
          });
        } else {
          console.warn("[PodcastView] Could not restore saved episode:", error);
        }
      });

    return () => {
      cancelled = true;
      if (!loaded) {
        if (restoredPodcastRef.current === resumable.id) restoredPodcastRef.current = null;
        if (requested && requestedPodcastRef.current === requested.id) requestedPodcastRef.current = null;
      }
    };
  }, [finalAudioUrl, isGenerating, podcasts, safeNotebookId, setFinalAudio, loadAudio, requestedPodcastId, toast]);

  // Handle progress updates
  const handleProgress = useCallback(
    (prog: StreamingProgress) => {
      updateProgress(prog);

      if (prog.phase === "complete") {
        toast({
          title: "Finishing podcast",
          description: "Speech segments are ready. Preparing playback and download...",
        });
      } else if (prog.phase === "error") {
        toast({
          title: "Generation Failed",
          description: prog.message,
          variant: "destructive",
        });
      }
    },
    [updateProgress, toast],
  );

  // Handle audio ready - called after each segment AND at completion
  const handleAudioReady = useCallback(
    (result: StreamingResult) => {
      const started = usePodcastGenerationStore.getState();
      if (started.notebookId !== safeNotebookId || !started.isGenerating || !started.script) return;
      const ownedScript = started.script;
      const isCurrent = () => {
        const state = usePodcastGenerationStore.getState();
        return state.notebookId === safeNotebookId && state.script === ownedScript && state.isGenerating;
      };
      setAudioReady(result.audioUrls);

      // Only combine and save when generation is complete
      const generator = getStreamingTTSGenerator();
      const isComplete = !generator.isRunning();
      const isKokoro = generator.isUsingKokoro();

      console.log("[PodcastView] handleAudioReady:", {
        segmentsReady: result.segmentsReady,
        totalUrls: result.audioUrls.length,
        isComplete,
        isKokoro,
        totalDuration: result.totalDuration,
      });

      if (isComplete && result.audioUrls.length > 0) {
        if (finalizingScriptRef.current === ownedScript) return;
        finalizingScriptRef.current = ownedScript;
        console.log("[PodcastView] Generation complete, combining audio...");

        const audioConfig = getPodcastAudioConfig();
        const enableStudioEQ = audioConfig.enableStudioEQ !== false;

        generator
          .combineAudios(enableStudioEQ)
          .then(async (combined) => {
            if (!isCurrent()) { if (combined?.startsWith('blob:')) URL.revokeObjectURL(combined); return; }
            console.log(
              "[PodcastView] combineAudios result:",
              combined ? "success" : "null (Web Speech mode)",
              "StudioEQ:",
              enableStudioEQ,
            );

            if (combined) {
              // Fail closed before publication: this check belongs to this exact run.
              let blob: Blob;
              let duration: number;
              try {
                const response = await fetch(combined);
                if (!response.ok) throw new Error('Could not read the generated audio.');
                blob = await response.blob();
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                const validation = await AudioValidator.validateBlob(blob);
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                if (!validation.valid || !validation.hasSpeech) {
                  throw new Error(validation.issues[0] || 'Generated audio is silent or could not be decoded.');
                }
                setAudioValidation(validation);
                duration = validation.duration;
              } catch (error) {
                URL.revokeObjectURL(combined);
                if (!isCurrent()) return;
                setAudioValidation(null);
                usePodcastGenerationStore.getState().cancelGeneration();
                updateProgress({ phase: 'error', currentSegment: 0, totalSegments: ownedScript.segments.length, percentage: 0, message: 'Generated audio failed its signal check. Retry from Studio.', canPlay: false });
                toast({
                  title: 'Audio check failed',
                  description: `${error instanceof Error ? error.message : 'Could not check the generated audio.'} Retry from Studio; if it happens again, try another voice.`,
                  variant: 'destructive',
                });
                return;
              }

              const scriptTitle = ownedScript.title || "Audio Overview";
              const saveInput: PodcastSave = {
                id: crypto.randomUUID(), title: scriptTitle, blob,
                duration, script: ownedScript,
                sourceIds: generationSourcesRef.current.get(ownedScript) || [],
              };
              try {
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                assertCurrent();
                if (blob.size > 1000 && blob.type.startsWith("audio/") && saveInput.sourceIds.length) {
                  const savedPodcast = await savePodcast(saveInput);
                  assertCurrent();
                  if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                  setFinalAudio(
                    combined,
                    safeNotebookId,
                    scriptTitle,
                    savedPodcast.id,
                  );
                  setPendingSave(null);
                } else {
                  throw new Error('The generated episode is missing valid audio or source information.');
                }
              } catch (e) {
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                setPendingSave({ input: saveInput, url: combined, scope: scopeKey, isCurrent,
                  error: e instanceof Error ? e.message : 'Could not save this episode.' });
                toast({
                  title: "Episode needs saving",
                  description: "Your audio is ready in this page. Retry saving before closing it.",
                  variant: "destructive",
                });
              }
            } else {
              throw new Error('No audio file was produced for validation.');
            }
          })
          .catch((err) => {
            if (!isCurrent()) return;
            console.error("[PodcastView] combineAudios error:", err);
            // Reset generating state to prevent UI freeze
            usePodcastGenerationStore.getState().cancelGeneration();
            toast({
              title: "Audio Compilation Failed",
              description:
                "Could not combine the generated audio segments. Please try again.",
              variant: "destructive",
            });
          });
      }
    },
    [safeNotebookId, setAudioReady, setFinalAudio, updateProgress, savePodcast, toast, scopeKey, assertCurrent],
  );

  // Generate podcast
  const handleGenerate = useCallback(async (options?: { sourceIds?: string[]; focus?: string }): Promise<boolean> => {
    if (!safeNotebookId || podcastPreparation || usePodcastGenerationStore.getState().isGenerating || getStreamingTTSGenerator().isRunning()) {
      toast({ title: 'Audio is already preparing or generating', description: 'Finish or cancel the current podcast first.' });
      return false;
    }
    const generationSources = options?.sourceIds ? usableSources.filter((source) => options.sourceIds?.includes(source.id)) : usableSources;
    if (options?.sourceIds && (options.sourceIds.length === 0 || generationSources.length !== new Set(options.sourceIds).size)) {
      toast({ title: 'Source selection changed', description: 'Choose ready sources from this notebook again.', variant: 'destructive' });
      return false;
    }
    const generationFocus = options?.focus ?? podcastFocus;
    if (generationSources.length === 0) {
      toast({
        title: "No ready sources",
        description: "Add a source or wait for processing to finish before generating audio.",
        variant: "destructive",
      });
      return false;
    }

    const preparation = { notebookId: safeNotebookId, cancelled: false };
    podcastPreparation = preparation;
    setIsStarting(true);
    toast({
      title: "Starting Generation",
      description: "Preparing podcast script...",
    });

    try {
      savePodcastAudioConfig({
        host1Voice,
        host2Voice,
      });

      const getGenderOfVoice = (voiceId: string): "male" | "female" => {
        const voice = KOKORO_VOICES[voiceId as keyof typeof KOKORO_VOICES];
        return (voice?.gender as "male" | "female") || "female";
      };

      const combinedContent = buildPodcastEvidenceContext(generationSources, {
        focus: generationFocus,
        maxChars: 12000,
      });

      const combinedNotes = [
        generationFocus.trim()
          ? `USER-SELECTED EPISODE FOCUS: ${generationFocus.trim()}`
          : "",
        ...(options?.sourceIds ? [] : notes || []).map((n) => n.content),
      ]
        .filter(Boolean)
        .join("\n\n")
        .substring(0, 3000);

      if (combinedContent.length < 100) {
        setIsStarting(false);
        toast({
          title: "Not enough content",
          description: "Your sources don't have enough text content.",
          variant: "destructive",
        });
        return false;
      }

      const generatedScript = await generatePodcastScript(combinedContent, {
        userNotes: combinedNotes,
        host1Name: host1,
        host2Name: host2,
        host1Gender: getGenderOfVoice(host1Voice),
        host2Gender: getGenderOfVoice(host2Voice),
        type: podcastType,
        format: podcastFormat,
      });

      if (preparation.cancelled) return false;
      if (!generatedScript.segments?.length) throw new Error('The podcast script has no spoken segments');
      // Inject our custom names and metadata into the script before starting
      generatedScript.metadata = {
        ...generatedScript.metadata,
        host1Name: host1,
        host2Name: host2,
        type: podcastType,
        format: podcastFormat,
      };

      generationSourcesRef.current.set(generatedScript, generationSources.map(source => source.id));
      startGeneration(safeNotebookId, generatedScript, {
        host1Name: host1,
        host2Name: host2,
        type: podcastType,
        format: podcastFormat,
      });
      setAudioValidation(null);

      setIsStarting(false);
      setShowAudioLab(false);

      const audioConfig = getPodcastAudioConfig();
      // Build the speaker-to-voice map from the generated script segments
      const speakerVoiceMap: Record<string, string> = {};
      const seenSpeakers = new Set<string>();
      for (const seg of generatedScript.segments) {
        if (!seenSpeakers.has(seg.speaker)) {
          seenSpeakers.add(seg.speaker);
          speakerVoiceMap[seg.speaker] =
            seg.speaker === host1
              ? audioConfig.host1Voice
              : audioConfig.host2Voice;
        }
      }

      const generator = getStreamingTTSGenerator();
      const isCurrent = () => {
        const state = usePodcastGenerationStore.getState();
        return state.notebookId === safeNotebookId && state.script === generatedScript && state.isGenerating;
      };
      void generator.startStreaming(
        generatedScript,
        {
          speed: audioConfig.speed,
          host1Voice: audioConfig.host1Voice,
          host2Voice: audioConfig.host2Voice,
          pauseBetweenSegments: audioConfig.pauseBetweenSegments,
          speakerVoiceMap,
        },
        (next) => { if (isCurrent()) handleProgress(next); },
        (next) => { if (isCurrent()) handleAudioReady(next); },
      ).catch((error) => {
        if (!isCurrent()) return;
        cancelGeneration();
        updateProgress({ phase: 'error', currentSegment: 0, totalSegments: generatedScript.segments.length, percentage: 0, message: 'Podcast audio generation failed', canPlay: false, usingKokoro: false });
        toast({ title: 'Audio generation failed', description: error instanceof Error ? error.message : 'Try again from Studio.', variant: 'destructive' });
      });
      return true;
    } catch (error) {
      console.error("Generation failed:", error);
      setIsStarting(false);
      toast({
        title: "Generation Failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsStarting(false);
      if (podcastPreparation === preparation) podcastPreparation = null;
    }
  }, [safeNotebookId, toast, usableSources, podcastFocus, host1Voice, host2Voice, notes, host1, host2, podcastType, podcastFormat, startGeneration, handleProgress, handleAudioReady, cancelGeneration, updateProgress]);

  const handleCancel = useCallback(() => {
    if (podcastPreparation?.notebookId === safeNotebookId) podcastPreparation.cancelled = true;
    setIsStarting(false);
    if (usePodcastGenerationStore.getState().notebookId === safeNotebookId) cancelGeneration();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    toast({ title: "Cancelled", description: "Generation was cancelled" });
  }, [safeNotebookId, cancelGeneration, toast]);

  useEffect(() => {
    if (audioCommand?.kind !== 'podcast' || audioCommand.phase !== 'queued' || !sources) return;
    const command = useStudioAudioCommands.getState().claim(safeNotebookId, 'podcast');
    if (!command) return;
    const finish = (ok: boolean, message: string) => useStudioAudioCommands.getState().finish(safeNotebookId, command.id, ok, message);
    setIsMinimized(false);
    if (command.operation === 'open') { finish(true, 'Podcast Studio is open with its playback and download controls.'); return; }
    const current = usePodcastGenerationStore.getState();
    const belongsHere = current.notebookId === safeNotebookId;
    if (command.operation === 'status') { finish(belongsHere, belongsHere ? current.progress?.message || (current.audioUrl ? 'Podcast playback is available in Studio.' : 'No active podcast generation.') : 'There is no podcast job in this notebook.'); return; }
    if (command.operation === 'cancel') {
      if (podcastPreparation?.notebookId !== safeNotebookId && !(belongsHere && current.isGenerating)) { finish(false, 'There is no active podcast in this notebook to cancel.'); return; }
      handleCancel(); finish(true, 'Podcast generation was cancelled. No completed download is claimed.'); return;
    }
    if (command.operation === 'resume') { finish(false, 'Browser podcast generation cannot resume across a page reload yet. Confirm a new generation in Studio instead.'); return; }
    void handleGenerate({ sourceIds: command.sourceIds, focus: command.focus }).then((ok) => finish(ok, ok ? 'Podcast generation has started using the selected sources. Follow its progress here or in Studio.' : 'Podcast generation did not start. Check the selected sources or active generation.')).catch(() => finish(false, 'Podcast generation could not start.'));
  }, [audioCommand, sources, safeNotebookId, handleGenerate, handleCancel]);

  const formatETA = (seconds?: number): string => {
    if (!seconds) return "";
    if (seconds < 60) return `~${seconds}s`;
    return `~${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  if (pendingSave && pendingSave.scope === scopeKey) {
    return <div className="podcast-card podcast-player-container studypod-audio-card">
      <section className="studypod-listen" aria-labelledby="studypod-unsaved-listen-heading">
        <div className="studypod-audio-section-heading">
          <span className="studypod-audio-eyebrow">Listen</span>
          <h3 id="studypod-unsaved-listen-heading">Current audio overview</h3>
          <p>Listen or download while this page remains open. Save before closing or reloading.</p>
        </div>
        <AudioPlayer audioUrl={pendingSave.url} title={pendingSave.input.title} allowDelete={false} />
      </section>
      <section className="studypod-create" aria-labelledby="studypod-unsaved-save-heading">
        <div className="studypod-audio-section-heading">
          <span className="studypod-audio-eyebrow">Save</span>
          <h3 id="studypod-unsaved-save-heading">Episode needs saving</h3>
        </div>
        <p role="alert">{pendingSave.error}</p>
        <button type="button" disabled={isRetryingSave} onClick={() => void retrySave()}>
          {isRetryingSave ? 'Saving podcast...' : 'Retry saving podcast'}
        </button>
        <button type="button" disabled={isRetryingSave} onClick={() => {
          URL.revokeObjectURL(pendingSave.url); setPendingSave(null); handleCancel();
        }}>Discard unsaved episode</button>
      </section>
    </div>;
  }

  // Minimized view during generation
  if (isGenerating && isMinimized) {
    return (
      <div className="podcast-card podcast-minimized">
        <div className="minimized-content">
          <div className="minimized-animation">
            <div className="mini-wave"></div>
            <div className="mini-wave"></div>
            <div className="mini-wave"></div>
          </div>
          <div className="minimized-info">
            <span className="minimized-status">
              {progress?.currentSegment || 0}/{progress?.totalSegments || 0}
            </span>
            <span className="minimized-percent">
              {progress?.percentage || 0}%
            </span>
          </div>
          <div className="minimized-actions">
            <button
              className="minimized-btn"
              onClick={() => setIsMinimized(false)}
              title="Expand"
            >
              <FontAwesomeIcon icon={faExpand} />
            </button>
            <button
              className="minimized-btn cancel"
              onClick={handleCancel}
              title="Cancel"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>
        <div className="minimized-progress">
          <div
            className="minimized-progress-fill"
            style={{ width: `${progress?.percentage || 0}%` }}
          />
        </div>
      </div>
    );
  }

  // Initial state - no script & no audio
  if (!finalAudioUrl && !isGenerating) {
    return (
      <div className="podcast-card studypod-audio-card">
        <section className="studypod-listen" aria-labelledby="studypod-listen-heading">
          <div className="studypod-audio-section-heading">
            <span className="studypod-audio-eyebrow">Listen</span>
            <h3 id="studypod-listen-heading">Saved audio overviews</h3>
            <p>Pick up an episode you created for this notebook.</p>
          </div>
          <div className="studypod-listen-history">
            <PodcastHistory
              notebookId={safeNotebookId}
              sources={sources}
              sourcesLoading={sourcesLoading}
              sourcesError={sourcesError}
              sourcesFetching={sourcesFetching}
              retrySources={() => { void retrySources(); }}
              onOpenSource={onOpenSource ? openRecordedSource : undefined}
              onPlay={(url, title, podcastId) => {
                if (
                  restoredAudioUrlRef.current &&
                  restoredAudioUrlRef.current !== url
                ) {
                  URL.revokeObjectURL(restoredAudioUrlRef.current);
                }
                restoredAudioUrlRef.current = url;
                restoredAudioNotebookRef.current = safeNotebookId;
                restoredPodcastRef.current = podcastId;
                setFinalAudio(url, safeNotebookId, title, podcastId);
              }}
              onDeleted={handleDeletedPodcast}
              currentAudioUrl={finalAudioUrl}
              currentPodcastId={currentPodcastId}
            />
          </div>
        </section>

        <section className="studypod-create" aria-labelledby="studypod-create-heading">
          <div className="studypod-audio-section-heading">
            <span className="studypod-audio-eyebrow">Create</span>
            <h3 id="studypod-create-heading">New audio overview</h3>
            <p>Create a guided reading of selected source passages, with brief host introductions.</p>
            <p id="studypod-audio-source-scope" role="status" aria-live="polite">{sourceScopeMessage}</p>
          </div>
        <div className="podcast-header">
          <div className="podcast-icon">
            <FontAwesomeIcon icon={faMicrophone} />
          </div>
          <div className="podcast-title-section">
            <h3 className="podcast-title">Audio Overview</h3>
            <p className="podcast-subtitle">
              Selected source passages read in their original words, with short introductions.
            </p>
          </div>
        </div>

        {showAudioLab ? (
          <div id="studypod-audio-customize" className="audio-lab-overlay glassmorphism">
            <div className="audio-lab-header">
              <h4 ref={customizeHeadingRef} tabIndex={-1}>
                <FontAwesomeIcon icon={faFlask} aria-hidden="true" /> Customize audio
              </h4>
              <button
                type="button"
                className="close-lab"
                aria-label="Close audio customization"
                onClick={() => {
                  setShowAudioLab(false);
                  requestAnimationFrame(() => customizeAudioRef.current?.focus());
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div
              className="lab-length-selector"
              style={{ marginBottom: "16px" }}
            >
              <Label>
                <FontAwesomeIcon icon={faMicrophone} /> Audio Format
              </Label>
              <Tabs
                value={podcastFormat}
                onValueChange={(val) =>
                  setPodcastFormat(val as "dialogue" | "solo")
                }
                className="w-full"
              >
                <TabsList className="audio-format-tabs-list grid w-full grid-cols-2">
                  <TabsTrigger value="dialogue">Two-host reading</TabsTrigger>
                  <TabsTrigger value="solo">Solo reading</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div
              className="lab-input-group"
              style={{ marginBottom: "16px" }}
            >
              <Label htmlFor="podcastFocus">
                <FontAwesomeIcon icon={faKeyboard} /> Episode Focus
              </Label>
              <Input
                id="podcastFocus"
                value={podcastFocus}
                onChange={(event) => setPodcastFocus(event.target.value)}
                placeholder="e.g. Book VII: the cave, education, and philosopher-rulers"
                className="lab-input"
                maxLength={500}
              />
              <p className="lab-hint">
                Optional. Name a book, chapter, concept, or question to help select
                passages. A long source may be covered only in part.
              </p>
            </div>

            <div className="lab-length-selector">
              <Label>
                <FontAwesomeIcon icon={faHourglassHalf} /> Passage coverage
              </Label>
              <Tabs
                value={podcastType}
                onValueChange={(val) =>
                  setPodcastType(val as "brief" | "standard" | "deep-dive")
                }
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="brief">Brief</TabsTrigger>
                  <TabsTrigger value="standard">Standard</TabsTrigger>
                  <TabsTrigger value="deep-dive">Deep Dive</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="lab-hint">
                {podcastType === "brief" &&
                  "A shorter selection of complete source passages."}
                {podcastType === "standard" &&
                  "A standard selection of complete source passages. Length depends on the source."}
                {podcastType === "deep-dive" &&
                  "A broader selection of complete source passages where available."}
              </p>
            </div>

            <details className="audio-voice-disclosure">
              <summary>
                <span>{podcastFormat === "solo" ? "Narrator and voice settings" : "Host and voice settings"}</span>
                <span className="audio-voice-disclosure-note">
                  {podcastFormat === "solo" ? "Optional · customize narration" : "Optional · customize speakers"}
                </span>
              </summary>
              <div
                className={`audio-lab-grid${podcastFormat === "solo" ? " audio-lab-grid--solo" : ""}`}
              >
                <div className="flex flex-col gap-4">
                  <div className="lab-input-group">
                    <Label htmlFor="host1">
                      <FontAwesomeIcon icon={faKeyboard} />{" "}
                      {podcastFormat === "solo" ? "Narrator Name" : "Host 1 Name"}
                    </Label>
                    <Input
                      id="host1"
                      value={host1}
                      onChange={(e) => setHost1(e.target.value)}
                      placeholder="e.g. Alex"
                      className="lab-input"
                    />
                  </div>
                  <div className="lab-input-group">
                    <Label htmlFor="host1Voice">
                      <FontAwesomeIcon icon={faMicrophone} />{" "}
                      {podcastFormat === "solo"
                        ? "Narrator Voice"
                        : "Host 1 Voice"}
                    </Label>
                    <Select value={host1Voice} onValueChange={setHost1Voice}>
                      <SelectTrigger id="host1Voice" className="lab-input audio-voice-select flex items-center justify-between text-left text-slate-100">
                        <SelectValue placeholder="Select voice" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-800 text-slate-100 max-h-[250px] overflow-y-auto z-[100]">
                        <div className="px-2 py-1.5 text-xs font-semibold text-slate-400">
                          Male Voices
                        </div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === "male")
                          .map(([id, voice]) => (
                            <SelectItem
                              key={id}
                              value={id}
                              className="cursor-pointer hover:bg-slate-800 focus:bg-slate-800 text-slate-200"
                            >
                              {voice.name}
                            </SelectItem>
                          ))}
                        <div className="px-2 py-1.5 text-xs font-semibold text-slate-400 mt-2">
                          Female Voices
                        </div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === "female")
                          .map(([id, voice]) => (
                            <SelectItem
                              key={id}
                              value={id}
                              className="cursor-pointer hover:bg-slate-800 focus:bg-slate-800 text-slate-200"
                            >
                              {voice.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {podcastFormat === "dialogue" && (
                  <div className="flex flex-col gap-4">
                    <div className="lab-input-group">
                      <Label htmlFor="host2">
                        <FontAwesomeIcon icon={faKeyboard} /> Host 2 Name
                      </Label>
                      <Input
                        id="host2"
                        value={host2}
                        onChange={(e) => setHost2(e.target.value)}
                        placeholder="e.g. Sarah"
                        className="lab-input"
                      />
                    </div>
                    <div className="lab-input-group">
                      <Label htmlFor="host2Voice">
                        <FontAwesomeIcon icon={faMicrophone} /> Host 2 Voice
                      </Label>
                      <Select value={host2Voice} onValueChange={setHost2Voice}>
                        <SelectTrigger id="host2Voice" className="lab-input audio-voice-select flex items-center justify-between text-left text-slate-100">
                          <SelectValue placeholder="Select voice" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-800 text-slate-100 max-h-[250px] overflow-y-auto z-[100]">
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-400">
                            Female Voices
                          </div>
                          {Object.entries(KOKORO_VOICES)
                            .filter(([_, v]) => v.gender === "female")
                            .map(([id, voice]) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="cursor-pointer hover:bg-slate-800 focus:bg-slate-800 text-slate-200"
                              >
                                {voice.name}
                              </SelectItem>
                            ))}
                          <div className="px-2 py-1.5 text-xs font-semibold text-slate-400 mt-2">
                            Male Voices
                          </div>
                          {Object.entries(KOKORO_VOICES)
                            .filter(([_, v]) => v.gender === "male")
                            .map(([id, voice]) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="cursor-pointer hover:bg-slate-800 focus:bg-slate-800 text-slate-200"
                              >
                                {voice.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </details>

            <button
              className={`podcast-generate-btn ${isStarting ? "loading" : ""}`}
              onClick={() => { void handleGenerate(); }}
              disabled={cannotCreateAudio || isStarting}
              aria-describedby="studypod-audio-source-scope"
              data-testid="btn-start-production"
            >
              {isStarting ? (
                <>
                  <FontAwesomeIcon icon={faArrowsRotate} spin />
                  Preparing script...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faPlay} />
                  Create audio overview
                </>
              )}
            </button>
          </div>
        ) : (
          <button
            ref={customizeAudioRef}
            type="button"
            className="podcast-generate-btn"
            onClick={() => setShowAudioLab(true)}
            aria-expanded={false}
            disabled={cannotCreateAudio}
            aria-describedby="studypod-audio-source-scope"
            data-testid="btn-generate-podcast"
          >
            <FontAwesomeIcon icon={faPlay} />
            Customize audio
          </button>
        )}

        <div className="podcast-settings-row">
          <button
            className="podcast-settings-btn"
            onClick={() => setIsProviderSettingsOpen(true)}
          >
            <FontAwesomeIcon icon={faGear} /> Voice and provider settings
          </button>
        </div>
        </section>

        <TTSProviderSettings
          isOpen={isProviderSettingsOpen}
          onClose={() => setIsProviderSettingsOpen(false)}
        />

      </div>
    );
  }

  // Generating state
  if (isGenerating) {
    return (
      <div
        className="podcast-card podcast-generating"
        data-testid="podcast-generating-card"
      >
        <div className="generating-header">
          <span className="generating-title">Generating Podcast</span>
          <div className="generating-actions">
            <button
              className="generating-action-btn"
              onClick={() => setIsMinimized(true)}
              title="Minimize"
            >
              <FontAwesomeIcon icon={faMinimize} />
            </button>
            <button
              className="generating-action-btn cancel"
              onClick={handleCancel}
              title="Cancel"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>

        <div className="generating-animation">
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
        </div>

        <p className="generating-status">
          {progress?.message || "Preparing..."}
        </p>

        <div className="generating-progress">
          <div
            className="generating-progress-fill"
            style={{ width: `${progress?.percentage || 0}%` }}
          />
        </div>

        <div className="generating-meta">
          <span className="generating-percent">
            {progress?.percentage || 0}%
          </span>
          {progress?.estimatedTimeRemaining && (
            <span className="generating-eta">
              <FontAwesomeIcon icon={faClock} />{" "}
              {formatETA(progress.estimatedTimeRemaining)}
            </span>
          )}
        </div>

        <p className="generating-hint">
          Preparing audio segments. Keep this page open until the episode is saved.
        </p>
      </div>
    );
  }

  // Final Player state - Generation Complete
  return (
    <div className="podcast-card podcast-player-container studypod-audio-card">
      <section className="studypod-listen" aria-labelledby="studypod-current-listen-heading">
        <div className="studypod-audio-section-heading">
          <span className="studypod-audio-eyebrow">Listen</span>
          <h3 id="studypod-current-listen-heading">Current audio overview</h3>
          <p>Listen here, then return to another saved episode below.</p>
        </div>
      <AudioPlayer
        audioUrl={finalAudioUrl!}
        title={script?.title || "Audio Overview"}
        notebookId={safeNotebookId}
        mediaId={
          currentPodcastId ||
          `podcast:${safeNotebookId}:${script?.title || "current"}`
        }
        mediaKind="podcast"
        onDeleted={() => {
          // Reset the store when deleted
          // We'll trust the parent or store to update locally
          usePodcastGenerationStore.getState().reset();
        }}
      />

      {audioValidation && !audioValidation.hasSpeech && (
        <div className="podcast-validation-warning">
          <span className="validation-icon" aria-hidden="true">
            !
          </span>
          <span className="validation-text">
            Audio may be silent ({audioValidation.issues[0] || "unknown issue"}
            ). Try regenerating with different voices or speed.
          </span>
        </div>
      )}
      {audioValidation && audioValidation.hasSpeech && (
        <div className="podcast-validation-ok">
          <span className="validation-icon" aria-hidden="true">
            ✓
          </span>
          <span className="validation-text">
            Audio signal detected ({audioValidation.duration.toFixed(0)}s,{" "}
            {audioValidation.sampleRate / 1000}kHz)
          </span>
        </div>
      )}

      <div className="studypod-listen-history">
        <PodcastHistory
          notebookId={safeNotebookId}
          sources={sources}
          sourcesLoading={sourcesLoading}
          sourcesError={sourcesError}
          sourcesFetching={sourcesFetching}
          retrySources={() => { void retrySources(); }}
          onOpenSource={onOpenSource ? openRecordedSource : undefined}
          onPlay={(url, title, podcastId) => {
            if (
              restoredAudioUrlRef.current &&
              restoredAudioUrlRef.current !== url
            ) {
              URL.revokeObjectURL(restoredAudioUrlRef.current);
            }
            restoredAudioUrlRef.current = url;
            restoredAudioNotebookRef.current = safeNotebookId;
            restoredPodcastRef.current = podcastId;
            setFinalAudio(url, safeNotebookId, title, podcastId);
          }}
          onDeleted={handleDeletedPodcast}
          currentAudioUrl={finalAudioUrl}
          currentPodcastId={currentPodcastId}
        />
      </div>
      </section>

      <section className="studypod-create studypod-create-again" aria-labelledby="studypod-create-again-heading">
        <div className="studypod-audio-section-heading">
          <span className="studypod-audio-eyebrow">Create</span>
          <h3 id="studypod-create-again-heading">Make another overview</h3>
          <p id="studypod-audio-regenerate-scope" role="status" aria-live="polite">{sourceScopeMessage}</p>
        </div>
        <div className="player-footer">
          <button className="footer-btn" onClick={() => { void handleGenerate(); }} disabled={cannotCreateAudio || isStarting} aria-describedby="studypod-audio-regenerate-scope">
            <FontAwesomeIcon icon={faArrowsRotate} /> Regenerate overview
          </button>
          <button className="footer-btn" onClick={() => setIsSettingsOpen(true)}>
            <FontAwesomeIcon icon={faGear} /> Settings
          </button>
        </div>
      </section>

      <TTSSettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <TTSProviderSettings
        isOpen={isProviderSettingsOpen}
        onClose={() => setIsProviderSettingsOpen(false)}
      />

    </div>
  );
};

export default PodcastView;
