import React, { useState } from 'react';
import { Citation } from '@/types/message';

interface CitationBadgeProps {
  index: number;
  citation?: Citation;
  isHovered?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const CitationBadge = ({
  index,
  citation,
  isHovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: CitationBadgeProps) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        className={`
          inline-flex items-center justify-center
          min-w-[1.25rem] h-5 px-1.5 mx-0.5
          text-xs font-medium rounded-full
          transition-all duration-200
          ${isHovered 
            ? 'bg-purple-600 text-white scale-110' 
            : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
          }
        `}
        onClick={onClick}
        onMouseEnter={() => {
          setShowTooltip(true);
          onMouseEnter();
        }}
        onMouseLeave={() => {
          setShowTooltip(false);
          onMouseLeave();
        }}
        aria-label={citation ? `Citation ${index}: ${citation.source_title}` : `Citation ${index}`}
      >
        {index}
      </button>
      
      {showTooltip && citation && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-gray-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 whitespace-nowrap max-w-xs">
            <div className="font-medium truncate">{citation.source_title}</div>
            {citation.chunk_lines_from && citation.chunk_lines_to && (
              <div className="text-gray-300 mt-0.5">
                Lines {citation.chunk_lines_from}-{citation.chunk_lines_to}
              </div>
            )}
            <div
              className="absolute left-1/2 transform -translate-x-1/2 top-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid #111827',
              }}
            />
          </div>
        </div>
      )}
    </span>
  );
};
