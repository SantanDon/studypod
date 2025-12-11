import React, { useState, useRef } from 'react';
import { Citation } from '@/types/message';
import { CitationMatch } from '@/types/citation';

interface CitationHighlightProps {
  text: string;
  citation: Citation;
  citationMatch?: CitationMatch;
  onScrollToSource?: (citation: Citation) => void;
  className?: string;
}

const CitationHighlight = ({
  text,
  citation,
  citationMatch,
  onScrollToSource,
  className = '',
}: CitationHighlightProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const highlightRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const handleClick = () => {
    if (onScrollToSource) {
      onScrollToSource(citation);
    }
  };

  const confidenceColor = citationMatch
    ? getConfidenceColor(citationMatch.confidence)
    : 'bg-purple-100 border-purple-300';

  return (
    <>
      <span
        ref={highlightRef}
        className={`
          inline px-0.5 py-0.5 rounded cursor-pointer
          border-b-2 transition-all duration-200
          hover:bg-purple-200 hover:border-purple-500
          ${confidenceColor}
          ${className}
        `}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleClick();
          }
        }}
        aria-label={`Citation from ${citation.source_title}. Click to view source.`}
      >
        {text}
      </span>

      {showTooltip && (
        <CitationTooltip
          citation={citation}
          citationMatch={citationMatch}
          position={tooltipPosition}
          onScrollToSource={onScrollToSource}
        />
      )}
    </>
  );
};

interface CitationTooltipProps {
  citation: Citation;
  citationMatch?: CitationMatch;
  position: { x: number; y: number };
  onScrollToSource?: (citation: Citation) => void;
}

const CitationTooltip = ({
  citation,
  citationMatch,
  position,
  onScrollToSource,
}: CitationTooltipProps) => {
  const getSourceIcon = (type: string): string => {
    const iconMap: Record<string, string> = {
      pdf: '📄',
      text: '📝',
      website: '🌐',
      youtube: '📺',
      audio: '🎵',
    };
    return iconMap[type] || '📄';
  };

  return (
    <div
      className="fixed z-50 transform -translate-x-1/2 -translate-y-full pointer-events-none"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="bg-gray-900 text-white text-sm rounded-lg shadow-xl p-3 max-w-xs pointer-events-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{getSourceIcon(citation.source_type)}</span>
          <span className="font-medium truncate">{citation.source_title}</span>
        </div>

        {citation.chunk_lines_from && citation.chunk_lines_to && (
          <div className="text-gray-300 text-xs mb-2">
            Lines {citation.chunk_lines_from}-{citation.chunk_lines_to}
          </div>
        )}

        {citationMatch && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Confidence:</span>
            <div className="flex items-center gap-1">
              <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getConfidenceBarColor(
                    citationMatch.confidence
                  )}`}
                  style={{ width: `${citationMatch.confidence * 100}%` }}
                />
              </div>
              <span className="text-gray-300">
                {Math.round(citationMatch.confidence * 100)}%
              </span>
            </div>
          </div>
        )}

        {onScrollToSource && (
          <button
            className="mt-2 text-xs text-purple-300 hover:text-purple-100 flex items-center gap-1"
            onClick={() => onScrollToSource(citation)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View in source
          </button>
        )}

        <div
          className="absolute left-1/2 transform -translate-x-1/2 top-full"
          style={{
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid #111827',
          }}
        />
      </div>
    </div>
  );
};

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-green-100 border-green-400';
  } else if (confidence >= 0.5) {
    return 'bg-yellow-100 border-yellow-400';
  } else {
    return 'bg-orange-100 border-orange-400';
  }
}

function getConfidenceBarColor(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-green-400';
  } else if (confidence >= 0.5) {
    return 'bg-yellow-400';
  } else {
    return 'bg-orange-400';
  }
}

export default CitationHighlight;
