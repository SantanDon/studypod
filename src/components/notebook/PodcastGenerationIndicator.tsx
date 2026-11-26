/**
 * Global Podcast Generation Indicator
 * Shows a small floating indicator when podcast is generating in background
 */

import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faXmark, faCirclePlay, faCirclePause } from '@fortawesome/free-solid-svg-icons';
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
import { getStreamingTTSGenerator, podcastStageLabel } from '@/lib/tts/streamingTTSGenerator';
import './PodcastGenerationIndicator.css';

interface PodcastGenerationIndicatorProps {
  onNavigateToPodcast?: () => void;
}

const PodcastGenerationIndicator: React.FC<PodcastGenerationIndicatorProps> = ({
  onNavigateToPodcast,
}) => {
  // Use direct store access for the indicator (it's global, not notebook-specific)
  const isGenerating = usePodcastGenerationStore((state) => state.isGenerating);
  const progress = usePodcastGenerationStore((state) => state.progress);
  const canPlayPartial = usePodcastGenerationStore((state) => state.canPlayPartial);
  const partialAudioUrls = usePodcastGenerationStore((state) => state.partialAudioUrls);
  const cancelGeneration = usePodcastGenerationStore((state) => state.cancelGeneration);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  useEffect(() => {
    if (!isGenerating) {
      setIsPreviewPlaying(false);
    }
  }, [isGenerating]);

  useEffect(() => {
    if (!isGenerating) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isGenerating]);

  if (!isGenerating) return null;
  const Info = onNavigateToPodcast ? 'button' : 'div';

  const handlePlayPartial = () => {
    const generator = getStreamingTTSGenerator();

    if (isPreviewPlaying || generator.isCurrentlyPlaying()) {
      generator.stopPlayback();
      setIsPreviewPlaying(false);
      return;
    }

    if (partialAudioUrls.length > 0) {
      generator.playAll(0, undefined, () => setIsPreviewPlaying(false));
      setIsPreviewPlaying(true);
    }
  };

  const handleCancelGeneration = () => {
    getStreamingTTSGenerator().stopPlayback();
    setIsPreviewPlaying(false);
    cancelGeneration();
  };

  return (
    <div className="podcast-generation-indicator">
      <div className="indicator-content">
        <div className="indicator-icon">
          <FontAwesomeIcon icon={faMicrophone} />
          <div className="indicator-pulse"></div>
        </div>
        
        <Info className="indicator-info text-left" onClick={onNavigateToPodcast}>
          <span className="indicator-title">Generating podcast · Keep this tab open</span>
          <span className="indicator-progress" aria-live="polite" aria-atomic="true">
            {podcastStageLabel(progress)}
          </span>
        </Info>

        <div className="indicator-actions">
          {canPlayPartial && (
            <button 
              className="indicator-btn play"
              onClick={handlePlayPartial}
              title={isPreviewPlaying ? 'Pause available audio' : 'Play available audio'}
              aria-label={isPreviewPlaying ? 'Pause available audio' : 'Play available audio'}
            >
              <FontAwesomeIcon icon={isPreviewPlaying ? faCirclePause : faCirclePlay} />
            </button>
          )}
          <button 
            className="indicator-btn cancel"
            onClick={handleCancelGeneration}
            title="Cancel generation"
            aria-label="Cancel podcast generation"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>
      
      <div className="indicator-progress-bar">
        <div 
          className="indicator-progress-fill"
          style={{ width: `${progress?.percentage || 0}%` }}
        />
      </div>
    </div>
  );
};

export default PodcastGenerationIndicator;
