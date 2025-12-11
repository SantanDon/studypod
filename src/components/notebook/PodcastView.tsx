import React, { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faPlay,
  faArrowsRotate,
  faGear,
  faSliders,
  faXmark,
  faMinimize,
  faExpand,
  faClock,
} from "@fortawesome/free-solid-svg-icons";
import { useSources } from "@/hooks/useSources";
import { generatePodcastScript } from "@/lib/podcastGenerator";
import { useToast } from "@/hooks/use-toast";
import TTSSettingsDialog from "./TTSSettingsDialog";
import TTSProviderSettings from "./TTSProviderSettings";
import {
  usePodcastGenerationStore,
  usePodcastIsGenerating,
  usePodcastProgress,
  usePodcastScript,
  usePodcastAudioUrl,
} from "@/stores/podcastGenerationStore";
import { getStreamingTTSGenerator, StreamingProgress, StreamingResult } from "@/lib/tts/streamingTTSGenerator";
import AudioPlayer from "./AudioPlayer";
import "./PodcastView.css";
import { PodcastHistory } from "./PodcastHistory";
import { usePodcastHistory } from "@/hooks/usePodcastHistory";

interface PodcastViewProps {
  notebookId?: string;
}

const PodcastView: React.FC<PodcastViewProps> = ({ notebookId }) => {
  const safeNotebookId = notebookId || '';
  const { sources } = useSources(safeNotebookId);
  const { toast } = useToast();

  // Store state
  const isGenerating = usePodcastIsGenerating(safeNotebookId);
  const progress = usePodcastProgress(safeNotebookId);
  const script = usePodcastScript(safeNotebookId);
  // We now use the final audio URL for playback instead of the segment sequencer
  const finalAudioUrl = usePodcastAudioUrl(safeNotebookId);

  const {
    startGeneration,
    updateProgress,
    setAudioReady,
    setFinalAudio,
    cancelGeneration,
  } = usePodcastGenerationStore();

  // Local state
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProviderSettingsOpen, setIsProviderSettingsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [usingKokoro, setUsingKokoro] = useState(false);

  const { savePodcast } = usePodcastHistory(safeNotebookId);

  // Only stop playback on unmount, NOT generation
  // Generation continues in background via the singleton generator and global store
  useEffect(() => {
    return () => {
      // Only stop active playback, not generation
      // The generator singleton keeps running in background
      const generator = getStreamingTTSGenerator();
      generator.stopPlayback(); // Stop playback only, not generation
      
      // Stop Web Speech playback only
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
      }
    };
  }, []);

  // Handle progress updates
  const handleProgress = useCallback((prog: StreamingProgress) => {
    updateProgress(prog);
    
    // Track which TTS engine is being used
    if (prog.usingKokoro !== undefined) {
      setUsingKokoro(prog.usingKokoro);
    }
    
    if (prog.phase === 'complete') {
      toast({
        title: "Podcast Ready",
        description: "Audio generated successfully.",
      });
    } else if (prog.phase === 'error') {
      toast({
        title: "Generation Failed",
        description: prog.message,
        variant: "destructive",
      });
    }
  }, [updateProgress, toast]);

  // Handle audio ready - called after each segment AND at completion
  const handleAudioReady = useCallback((result: StreamingResult) => {
    setAudioReady(result.audioUrls);
    
    // Only combine and save when generation is complete
    const generator = getStreamingTTSGenerator();
    const isComplete = !generator.isRunning();
    const isKokoro = generator.isUsingKokoro();
    
    console.log('[PodcastView] handleAudioReady:', {
      segmentsReady: result.segmentsReady,
      totalUrls: result.audioUrls.length,
      isComplete,
      isKokoro,
      totalDuration: result.totalDuration
    });
    
    if (isComplete && result.audioUrls.length > 0) {
      console.log('[PodcastView] Generation complete, combining audio...');
      
      generator.combineAudios().then(async combined => {
        console.log('[PodcastView] combineAudios result:', combined ? 'success' : 'null (Web Speech mode)');
        
        if (combined) {
          setFinalAudio(combined);
          
          // AUTO-SAVE to History (only for Kokoro which produces actual audio files)
          const currentScript = usePodcastGenerationStore.getState().script;
          const scriptTitle = currentScript?.title || 'Audio Overview';
          
          try {
            // Fetch the blob from the URL
            const response = await fetch(combined);
            const blob = await response.blob();
            
            console.log('[PodcastView] Auto-save check:', { 
              scriptTitle, 
              blobSize: blob.size,
              blobType: blob.type
            });
            
            // Only save if we have a meaningful audio blob (> 1000 bytes and audio type)
            if (blob.size > 1000 && blob.type.startsWith('audio/')) {
              console.log('[PodcastView] Saving podcast to history...');
              await savePodcast({ 
                title: scriptTitle, 
                blob, 
                duration: result.totalDuration 
              });
              console.log('[PodcastView] Podcast saved successfully!');
              toast({
                title: "Podcast Saved",
                description: "Automatically saved to history.",
              });
            } else {
              console.warn('[PodcastView] Skipping auto-save: invalid blob', { size: blob.size, type: blob.type });
            }
          } catch (e) {
            console.error("[PodcastView] Auto-save failed:", e);
            toast({
              title: "Auto-save Failed",
              description: "Could not save podcast to history.",
              variant: "destructive",
            });
          }
        } else {
          // Web Speech mode - no saveable audio, but we can still play via segment sequencer
          console.log('[PodcastView] Web Speech mode - audio plays directly, cannot be saved');
          // Set a marker URL so the UI knows generation is complete
          // The AudioPlayer will need to use the segment sequencer for playback
          toast({
            title: "Podcast Ready",
            description: "Using browser speech. Audio cannot be saved in this mode.",
          });
        }
      }).catch(err => {
        console.error('[PodcastView] combineAudios error:', err);
      });
    }
  }, [setAudioReady, setFinalAudio, savePodcast, toast]);

  // Generate podcast
  const handleGenerate = async () => {
    if (!sources || sources.length === 0) {
      toast({
        title: "No sources",
        description: "Please add sources to your notebook first.",
        variant: "destructive",
      });
      return;
    }

    setIsStarting(true);
    toast({
      title: "Starting Generation",
      description: "Preparing podcast script...",
    });

    try {
      const combinedContent = sources
        .map((s) => s.content || '')
        .filter(c => c.length > 0)
        .join("\n\n")
        .substring(0, 15000);

      if (combinedContent.length < 100) {
        setIsStarting(false);
        toast({
          title: "Not enough content",
          description: "Your sources don't have enough text content.",
          variant: "destructive",
        });
        return;
      }

      const generatedScript = await generatePodcastScript(combinedContent);
      startGeneration(safeNotebookId, generatedScript);
      setIsStarting(false);

      const generator = getStreamingTTSGenerator();
      generator.startStreaming(
        generatedScript,
        { speed: 1.0 },
        handleProgress,
        handleAudioReady
      );

    } catch (error) {
      console.error("Generation failed:", error);
      setIsStarting(false);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    cancelGeneration();
    speechSynthesis?.cancel();
    toast({ title: "Cancelled", description: "Generation was cancelled" });
  };

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
            <span className="minimized-percent">{progress?.percentage || 0}%</span>
          </div>
          <div className="minimized-actions">
            <button className="minimized-btn" onClick={() => setIsMinimized(false)} title="Expand">
              <FontAwesomeIcon icon={faExpand} />
            </button>
            <button className="minimized-btn cancel" onClick={handleCancel} title="Cancel">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>
        <div className="minimized-progress">
          <div className="minimized-progress-fill" style={{ width: `${progress?.percentage || 0}%` }} />
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
            <p className="podcast-subtitle">AI-generated podcast from your sources</p>
          </div>
        </div>

        <div className="podcast-provider">
          <span className="provider-label">Engine</span>
          <span className="provider-value">Kokoro TTS (High Quality)</span>
        </div>

        <button
          className={`podcast-generate-btn ${isStarting ? 'loading' : ''}`}
          onClick={handleGenerate}
          disabled={!sources || sources.length === 0 || isStarting}
        >
          {isStarting ? (
            <>
              <FontAwesomeIcon icon={faArrowsRotate} spin />
              Preparing Script...
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={faPlay} />
              Generate Podcast
            </>
          )}
        </button>

        <div className="podcast-settings-row">
          <button className="podcast-settings-btn" onClick={() => setIsProviderSettingsOpen(true)}>
            <FontAwesomeIcon icon={faGear} /> Settings
          </button>
          <button className="podcast-settings-btn" onClick={() => setIsSettingsOpen(true)}>
            <FontAwesomeIcon icon={faSliders} /> Voices
          </button>
        </div>

        <TTSSettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        <TTSProviderSettings isOpen={isProviderSettingsOpen} onClose={() => setIsProviderSettingsOpen(false)} />
        
        {/* Podcast History */}
        <PodcastHistory 
            notebookId={safeNotebookId} 
            onPlay={(url, title) => {
                setFinalAudio(url);
            }}
            currentAudioUrl={finalAudioUrl}
        />
      </div>
    );
  }

  // Generating state
  if (isGenerating) {
    return (
      <div className="podcast-card podcast-generating">
        <div className="generating-header">
          <span className="generating-title">Generating Podcast</span>
          <div className="generating-actions">
            <button className="generating-action-btn" onClick={() => setIsMinimized(true)} title="Minimize">
              <FontAwesomeIcon icon={faMinimize} />
            </button>
            <button className="generating-action-btn cancel" onClick={handleCancel} title="Cancel">
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

        <p className="generating-status">{progress?.message || "Preparing..."}</p>
        
        <div className="generating-progress">
          <div className="generating-progress-fill" style={{ width: `${progress?.percentage || 0}%` }} />
        </div>

        <div className="generating-meta">
          <span className="generating-percent">{progress?.percentage || 0}%</span>
          {progress?.estimatedTimeRemaining && (
            <span className="generating-eta">
              <FontAwesomeIcon icon={faClock} /> {formatETA(progress.estimatedTimeRemaining)}
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
        onDeleted={() => {
           // Reset the store when deleted
           // We'll trust the parent or store to update locally
           usePodcastGenerationStore.getState().reset();
        }}
      />

      <div className="player-footer">
        <button className="footer-btn" onClick={handleGenerate}>
          <FontAwesomeIcon icon={faArrowsRotate} /> Regenerate
        </button>
        <button className="footer-btn" onClick={() => setIsSettingsOpen(true)}>
          <FontAwesomeIcon icon={faGear} /> Settings
        </button>
      </div>

      <TTSSettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <TTSProviderSettings isOpen={isProviderSettingsOpen} onClose={() => setIsProviderSettingsOpen(false)} />
      
      {/* Podcast History */}
      <PodcastHistory 
        notebookId={safeNotebookId} 
        onPlay={(url, title) => {
             // We can use the store to set the "current" audio being played
             // Or just pass it to the AudioPlayer if we lift that state up.
             // For now, let's update the store's final audio
             setFinalAudio(url);
             // Also update script title just for display
             if (script) {
                 // We don't want to mutate the script in store if it's different, 
                 // but AudioPlayer uses script.title. 
                 // A better way is to passing 'title' to AudioPlayer directly, which we do below.
             }
        }}
        currentAudioUrl={finalAudioUrl}
      />
    </div>
  );
};

export default PodcastView;
