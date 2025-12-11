/**
 * Global Podcast Generation Indicator
 * Shows a small floating indicator when podcast is generating in background
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faXmark, faCirclePlay } from '@fortawesome/free-solid-svg-icons';
import { usePodcastGenerationStore } from '@/stores/podcastGenerationStore';
import { getStreamingTTSGenerator } from '@/lib/tts/streamingTTSGenerator';
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

  if (!isGenerating) return null;

  const handlePlayPartial = () => {
    if (partialAudioUrls.length > 0) {
      // Create a temporary audio element to play
      const audio = new Audio(partialAudioUrls[0]);
      audio.play();
    }
  };

  return (
    <div className="podcast-generation-indicator">
      <div className="indicator-content">
        <div className="indicator-icon">
          <FontAwesomeIcon icon={faMicrophone} />
          <div className="indicator-pulse"></div>
        </div>
        
        <div className="indicator-info" onClick={onNavigateToPodcast}>
          <span className="indicator-title">Generating Podcast</span>
          <span className="indicator-progress">
            {progress?.currentSegment || 0}/{progress?.totalSegments || 0} · {progress?.percentage || 0}%
          </span>
        </div>

        <div className="indicator-actions">
          {canPlayPartial && (
            <button 
              className="indicator-btn play"
              onClick={handlePlayPartial}
              title="Play available audio"
            >
              <FontAwesomeIcon icon={faCirclePlay} />
            </button>
          )}
          <button 
            className="indicator-btn cancel"
            onClick={cancelGeneration}
            title="Cancel generation"
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
