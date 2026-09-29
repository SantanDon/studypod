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
import { buildPodcastSourceContext } from "@/lib/podcastSourceContext";
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
  getResumableTime,
  loadPlaybackCheckpoint,
} from "@/lib/audio/playbackProgress";
import { indexedDBService } from "@/services/indexedDBService";
import { isSourceUsableForGroundedWork } from "@/lib/sources/sourceProcessing";

let podcastPreparation: { notebookId: string; cancelled: boolean } | null = null;

interface PodcastViewProps {
  notebookId?: string;
}

const PodcastView: React.FC<PodcastViewProps> = ({ notebookId }) => {
  const safeNotebookId = notebookId || "";
  const audioCommand = useStudioAudioCommands((state) => state.requests[safeNotebookId]);
  const { sources } = useSources(safeNotebookId);
  const usableSources = React.useMemo(() => (sources || []).filter(isSourceUsableForGroundedWork), [sources]);
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
  const [isStarting, setIsStarting] = useState(false);
  const [usingKokoro, setUsingKokoro] = useState(false);
  const [audioValidation, setAudioValidation] =
    useState<AudioValidationResult | null>(null);
  const restoredAudioUrlRef = useRef<string | null>(null);
  const restoredPodcastRef = useRef<string | null>(null);
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

  const { savePodcast, podcasts } = usePodcastHistory(safeNotebookId);

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
      if (restoredAudioUrlRef.current) {
        URL.revokeObjectURL(restoredAudioUrlRef.current);
        restoredAudioUrlRef.current = null;
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

  // Reopen the most recently played unfinished episode after a full page exit.
  useEffect(() => {
    if (
      !safeNotebookId ||
      finalAudioUrl ||
      isGenerating ||
      !podcasts?.length ||
      restoredPodcastRef.current
    ) {
      return;
    }

    const resumable = podcasts
      .map((podcast) => {
        const checkpoint = loadPlaybackCheckpoint(podcast.id);
        return {
          podcast,
          checkpoint,
          resumeAt: getResumableTime(checkpoint, podcast.duration),
        };
      })
      .filter((item) => item.resumeAt > 0 && item.checkpoint)
      .sort(
        (a, b) =>
          new Date(b.checkpoint!.updatedAt).getTime() -
          new Date(a.checkpoint!.updatedAt).getTime(),
      )[0];

    if (!resumable) return;

    let cancelled = false;
    restoredPodcastRef.current = resumable.podcast.id;
    void indexedDBService
      .getAudio(resumable.podcast.audio_blob_id)
      .then((blob) => {
        if (cancelled || !blob) {
          if (!blob) restoredPodcastRef.current = null;
          return;
        }
        const url = URL.createObjectURL(blob);
        restoredAudioUrlRef.current = url;
        setFinalAudio(
          url,
          safeNotebookId,
          resumable.podcast.title,
          resumable.podcast.id,
        );
      })
      .catch((error) => {
        restoredPodcastRef.current = null;
        console.warn("[PodcastView] Could not restore saved episode:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [finalAudioUrl, isGenerating, podcasts, safeNotebookId, setFinalAudio]);

  // Handle progress updates
  const handleProgress = useCallback(
    (prog: StreamingProgress) => {
      updateProgress(prog);

      // Track which TTS engine is being used
      if (prog.usingKokoro !== undefined) {
        setUsingKokoro(prog.usingKokoro);
      }

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
              // Validate the combined audio in background
              AudioValidator.validateBlob(
                await fetch(combined).then((r) => r.blob()),
              )
                .then((v) => {
                  if (usePodcastGenerationStore.getState().notebookId !== safeNotebookId) return;
                  setAudioValidation(v);
                  if (!v.hasSpeech) {
                    console.warn(
                      "[PodcastView] Audio validation detected possible silent output",
                      v.issues,
                    );
                    toast({
                      title: "Audio Quality Warning",
                      description:
                        v.issues[0] ||
                        "Generated audio may be silent. Try different voice settings.",
                      variant: "destructive",
                    });
                  } else {
                    console.info("[PodcastView] Audio validated successfully");
                  }
                })
                .catch((e) =>
                  console.warn("[PodcastView] Validation error:", e),
                );

              // AUTO-SAVE to History (only for Kokoro which produces actual audio files)
              const scriptTitle = ownedScript.title || "Audio Overview";

              try {
                // Fetch the blob from the URL
                const response = await fetch(combined);
                const blob = await response.blob();
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }

                console.log("[PodcastView] Auto-save check:", {
                  scriptTitle,
                  blobSize: blob.size,
                  blobType: blob.type,
                });

                // Only save if we have a meaningful audio blob (> 1000 bytes and audio type)
                if (blob.size > 1000 && blob.type.startsWith("audio/")) {
                  console.log("[PodcastView] Saving podcast to history...");
                  const savedPodcast = await savePodcast({
                    title: scriptTitle,
                    blob,
                    duration: result.totalDuration,
                  });
                  if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                  setFinalAudio(
                    combined,
                    safeNotebookId,
                    scriptTitle,
                    savedPodcast.id,
                  );
                  console.log("[PodcastView] Podcast saved successfully!");
                } else {
                  setFinalAudio(combined, safeNotebookId, scriptTitle);
                  console.warn(
                    "[PodcastView] Skipping auto-save: invalid blob",
                    { size: blob.size, type: blob.type },
                  );
                }
              } catch (e) {
                if (!isCurrent()) { URL.revokeObjectURL(combined); return; }
                setFinalAudio(combined, safeNotebookId, scriptTitle);
                console.error("[PodcastView] Auto-save failed:", e);
                toast({
                  title: "Auto-save Failed",
                  description: "Could not save podcast to history.",
                  variant: "destructive",
                });
              }
            } else {
              // Web Speech mode - no saveable audio, but we can still play via segment sequencer
              console.log(
                "[PodcastView] Web Speech mode - audio plays directly, cannot be saved",
              );
              // Set a marker URL so the UI knows generation is complete
              // The AudioPlayer will need to use the segment sequencer for playback
              setFinalAudio("webspeech_fallback");
              toast({
                title: "Podcast Ready",
                description:
                  "Using browser speech. Audio cannot be saved in this mode.",
              });
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
    [safeNotebookId, setAudioReady, setFinalAudio, savePodcast, toast],
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

      const combinedContent = buildPodcastSourceContext(generationSources, {
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
        host1Name: host1,
        host2Name: host2,
        type: podcastType,
        format: podcastFormat,
      };

      startGeneration(safeNotebookId, generatedScript, {
        host1Name: host1,
        host2Name: host2,
        type: podcastType,
        format: podcastFormat,
      });

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
      <div className="podcast-card">
        <div className="podcast-header">
          <div className="podcast-icon">
            <FontAwesomeIcon icon={faMicrophone} />
          </div>
          <div className="podcast-title-section">
            <h3 className="podcast-title">Audio Overview</h3>
            <p className="podcast-subtitle">
              AI-generated podcast from your sources
            </p>
          </div>
        </div>

        <div className="podcast-provider">
          <span className="provider-label">Engine</span>
          <span className="provider-value">Kokoro TTS (High Quality)</span>
        </div>

        {showAudioLab ? (
          <div className="audio-lab-overlay glassmorphism">
            <div className="audio-lab-header">
              <h4>
                <FontAwesomeIcon icon={faFlask} /> Audio Lab
              </h4>
              <button
                className="close-lab"
                onClick={() => setShowAudioLab(false)}
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
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="dialogue">Podcast (Dialogue)</TabsTrigger>
                  <TabsTrigger value="solo">Solo Explainer</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div
              className="audio-lab-grid"
              style={{
                gridTemplateColumns:
                  podcastFormat === "solo" ? "1fr" : "1fr 1fr",
                gap: "16px",
                marginBottom: "24px",
              }}
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
                    <SelectTrigger className="lab-input flex items-center justify-between text-left text-slate-100">
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
                      <SelectTrigger className="lab-input flex items-center justify-between text-left text-slate-100">
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
                Optional. Leave blank for a balanced overview across a long book,
                or name a book, chapter, concept, or question for the hosts to
                explore.
              </p>
            </div>

            <div className="lab-length-selector">
              <Label>
                <FontAwesomeIcon icon={faHourglassHalf} /> Episode Style
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
                  "~2-3 mins podcast covering highlights."}
                {podcastType === "standard" &&
                  "~7-10 mins educational deep dive."}
                {podcastType === "deep-dive" &&
                  "15+ mins comprehensive masterclass."}
              </p>
            </div>

            <button
              className={`podcast-generate-btn ${isStarting ? "loading" : ""}`}
              onClick={() => { void handleGenerate(); }}
              disabled={usableSources.length === 0 || isStarting}
              data-testid="btn-start-production"
            >
              {isStarting ? (
                <>
                  <FontAwesomeIcon icon={faArrowsRotate} spin />
                  Processing...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faPlay} />
                  Start Production
                </>
              )}
            </button>
          </div>
        ) : (
          <button
            className="podcast-generate-btn"
            onClick={() => setShowAudioLab(true)}
            disabled={usableSources.length === 0}
            data-testid="btn-generate-podcast"
          >
            <FontAwesomeIcon icon={faPlay} />
            Generate Podcast
          </button>
        )}

        <div className="podcast-settings-row">
          <button
            className="podcast-settings-btn"
            onClick={() => setIsProviderSettingsOpen(true)}
          >
            <FontAwesomeIcon icon={faGear} /> Audio Studio
          </button>
        </div>

        <TTSProviderSettings
          isOpen={isProviderSettingsOpen}
          onClose={() => setIsProviderSettingsOpen(false)}
        />

        {/* Podcast History */}
        <PodcastHistory
          notebookId={safeNotebookId}
          onPlay={(url, title, podcastId) => {
            if (
              restoredAudioUrlRef.current &&
              restoredAudioUrlRef.current !== url
            ) {
              URL.revokeObjectURL(restoredAudioUrlRef.current);
            }
            restoredAudioUrlRef.current = url;
            restoredPodcastRef.current = podcastId;
            setFinalAudio(url, safeNotebookId, title, podcastId);
          }}
          currentAudioUrl={finalAudioUrl}
          currentPodcastId={currentPodcastId}
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
          {usingKokoro
            ? "Generating high-quality audio in background (page stays responsive!)"
            : "Using browser's built-in voice for fast generation"}
        </p>
      </div>
    );
  }

  // Final Player state - Generation Complete
  return (
    <div className="podcast-card podcast-player-container">
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

      <div className="player-footer">
        <button className="footer-btn" onClick={() => { void handleGenerate(); }}>
          <FontAwesomeIcon icon={faArrowsRotate} /> Regenerate
        </button>
        <button className="footer-btn" onClick={() => setIsSettingsOpen(true)}>
          <FontAwesomeIcon icon={faGear} /> Settings
        </button>
      </div>

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
            Audio verified ({audioValidation.duration.toFixed(0)}s,{" "}
            {audioValidation.sampleRate / 1000}kHz)
          </span>
        </div>
      )}

      <TTSSettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <TTSProviderSettings
        isOpen={isProviderSettingsOpen}
        onClose={() => setIsProviderSettingsOpen(false)}
      />

      {/* Podcast History */}
      <PodcastHistory
        notebookId={safeNotebookId}
        onPlay={(url, title, podcastId) => {
          if (
            restoredAudioUrlRef.current &&
            restoredAudioUrlRef.current !== url
          ) {
            URL.revokeObjectURL(restoredAudioUrlRef.current);
          }
          restoredAudioUrlRef.current = url;
          restoredPodcastRef.current = podcastId;
          setFinalAudio(url, safeNotebookId, title, podcastId);
        }}
        currentAudioUrl={finalAudioUrl}
        currentPodcastId={currentPodcastId}
      />
    </div>
  );
};

export default PodcastView;
