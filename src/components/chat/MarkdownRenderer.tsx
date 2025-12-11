import React, { useState, useCallback } from 'react';
import { MessageSegment, Citation } from '@/types/message';
import CitationButton from './CitationButton';
import { extractCitations, mapCitationsToSources } from '@/lib/citations/citationManager';

interface MarkdownRendererProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  className?: string;
  onCitationClick?: (citation: Citation) => void;
  isUserMessage?: boolean;
}

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

const MarkdownRenderer = ({ content, className = '', onCitationClick, isUserMessage = false }: MarkdownRendererProps) => {
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null);

  const handleCitationHover = useCallback((index: number | null) => {
    setHoveredCitation(index);
  }, []);

  if (typeof content === 'object' && 'segments' in content) {
    return (
      <div className={className}>
        {processMarkdownWithCitations(
          content.segments, 
          content.citations, 
          onCitationClick, 
          isUserMessage,
          hoveredCitation,
          handleCitationHover
        )}
      </div>
    );
  }

  const textContent = typeof content === 'string' ? content : '';
  const parsedCitations = extractCitations(textContent);
  
  if (parsedCitations.length > 0) {
    return (
      <div className={className}>
        {renderTextWithCitationMarkers(
          textContent, 
          [], 
          onCitationClick,
          hoveredCitation,
          handleCitationHover
        )}
      </div>
    );
  }

  const segments: MessageSegment[] = [{ text: textContent }];
  const citations: Citation[] = [];
  
  return (
    <div className={className}>
      {processMarkdownWithCitations(
        segments, 
        citations, 
        onCitationClick, 
        isUserMessage,
        hoveredCitation,
        handleCitationHover
      )}
    </div>
  );
};

const renderTextWithCitationMarkers = (
  text: string,
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
): JSX.Element => {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  const regex = new RegExp(CITATION_MARKER_PATTERN.source, 'g');
  
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    
    const citationIndex = parseInt(match[1], 10);
    const citation = citations.find(
      c => c.citation_id === citationIndex || c.chunk_index === citationIndex - 1
    );
    
    parts.push(
      <CitationBadge
        key={`citation-${match.index}`}
        index={citationIndex}
        citation={citation}
        isHovered={hoveredCitation === citationIndex}
        onClick={() => {
          if (citation && onCitationClick) {
            onCitationClick(citation);
          }
        }}
        onMouseEnter={() => onHover?.(citationIndex)}
        onMouseLeave={() => onHover?.(null)}
      />
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return <>{parts}</>;
};

interface CitationBadgeProps {
  index: number;
  citation?: Citation;
  isHovered?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CitationBadge = ({
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

const processMarkdownWithCitations = (
  segments: MessageSegment[], 
  citations: Citation[], 
  onCitationClick?: (citation: Citation) => void,
  isUserMessage: boolean = false,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
) => {
  if (isUserMessage) {
    return (
      <span>
        {segments.map((segment, index) => (
          <span key={index}>
            {processInlineMarkdown(segment.text)}
            {segment.citation_id && onCitationClick && (
              <CitationButton
                chunkIndex={(() => {
                  const citation = citations.find(c => c.citation_id === segment.citation_id);
                  return citation?.chunk_index || 0;
                })()}
                onClick={() => {
                  const citation = citations.find(c => c.citation_id === segment.citation_id);
                  if (citation) {
                    onCitationClick(citation);
                  }
                }}
              />
            )}
          </span>
        ))}
      </span>
    );
  }

  const paragraphs: JSX.Element[] = [];
  
  segments.forEach((segment, segmentIndex) => {
    const citation = segment.citation_id ? citations.find(c => c.citation_id === segment.citation_id) : undefined;
    
    const paragraphTexts = segment.text.split('\n\n').filter(text => text.trim());
    
    paragraphTexts.forEach((paragraphText, paragraphIndex) => {
      const processedContent = processTextWithMarkdownAndCitations(
        paragraphText.trim(),
        citations,
        onCitationClick,
        hoveredCitation,
        onHover
      );
      
      paragraphs.push(
        <p key={`${segmentIndex}-${paragraphIndex}`} className="mb-4 leading-relaxed">
          {processedContent}
          {paragraphIndex === paragraphTexts.length - 1 && citation && onCitationClick && (
            <CitationButton
              chunkIndex={citation.chunk_index || 0}
              onClick={() => onCitationClick(citation)}
            />
          )}
        </p>
      );
    });
  });
  
  return paragraphs;
};

const processTextWithMarkdownAndCitations = (
  text: string,
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void,
  hoveredCitation?: number | null,
  onHover?: (index: number | null) => void
): (string | JSX.Element)[] => {
  const lines = text.split('\n');
  
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*|__.*?__|(?:\[\d+\]))/g);
    
    const processedLine = parts.map((part, partIndex) => {
      if (part.match(/^\*\*(.*)\*\*$/)) {
        const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
        return <strong key={`${lineIndex}-${partIndex}`}>{boldText}</strong>;
      } else if (part.match(/^__(.*__)$/)) {
        const boldText = part.replace(/^__(.*__)$/, '$1');
        return <strong key={`${lineIndex}-${partIndex}`}>{boldText}</strong>;
      } else if (part.match(/^\[\d+\]$/)) {
        const citationIndex = parseInt(part.replace(/\[(\d+)\]/, '$1'), 10);
        const citation = citations.find(
          c => c.citation_id === citationIndex || c.chunk_index === citationIndex - 1
        );
        
        return (
          <CitationBadge
            key={`${lineIndex}-${partIndex}-citation`}
            index={citationIndex}
            citation={citation}
            isHovered={hoveredCitation === citationIndex}
            onClick={() => {
              if (citation && onCitationClick) {
                onCitationClick(citation);
              }
            }}
            onMouseEnter={() => onHover?.(citationIndex)}
            onMouseLeave={() => onHover?.(null)}
          />
        );
      } else {
        return part;
      }
    });

    return (
      <span key={lineIndex}>
        {processedLine}
        {lineIndex < lines.length - 1 && <br />}
      </span>
    );
  });
};

// Helper function to process text with markdown formatting (bold, line breaks)
const processTextWithMarkdown = (text: string) => {
  const lines = text.split('\n');
  
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*|__.*?__)/g);
    
    const processedLine = parts.map((part, partIndex) => {
      if (part.match(/^\*\*(.*)\*\*$/)) {
        const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
        return <strong key={partIndex}>{boldText}</strong>;
      } else if (part.match(/^__(.*__)$/)) {
        const boldText = part.replace(/^__(.*__)$/, '$1');
        return <strong key={partIndex}>{boldText}</strong>;
      } else {
        return part;
      }
    });

    return (
      <span key={lineIndex}>
        {processedLine}
        {lineIndex < lines.length - 1 && <br />}
      </span>
    );
  });
};

// Function to process markdown inline without creating paragraph breaks
const processInlineMarkdown = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*|__.*?__)/g);
  
  return parts.map((part, partIndex) => {
    if (part.match(/^\*\*(.*)\*\*$/)) {
      const boldText = part.replace(/^\*\*(.*)\*\*$/, '$1');
      return <strong key={partIndex}>{boldText}</strong>;
    } else if (part.match(/^__(.*__)$/)) {
      const boldText = part.replace(/^__(.*__)$/, '$1');
      return <strong key={partIndex}>{boldText}</strong>;
    } else {
      // Replace line breaks with spaces for inline rendering
      return part.replace(/\n/g, ' ');
    }
  });
};

export default MarkdownRenderer;
