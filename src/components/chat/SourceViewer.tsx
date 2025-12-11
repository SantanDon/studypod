import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Citation } from '@/types/message';
import { CitationMatch, HighlightedExcerpt } from '@/types/citation';
import { generateHighlightedExcerpt } from '@/lib/citations/citationManager';

interface SourceViewerProps {
  citation: Citation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceContent?: string;
  highlightMatch?: CitationMatch;
  onJumpToChunk?: (chunkIndex: number) => void;
}

const SourceViewer = ({ 
  citation, 
  open, 
  onOpenChange,
  sourceContent,
  highlightMatch,
  onJumpToChunk,
}: SourceViewerProps) => {
  const [highlightedExcerpt, setHighlightedExcerpt] = useState<HighlightedExcerpt | null>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (citation && sourceContent) {
      const excerpt = generateHighlightedExcerpt(citation, sourceContent);
      setHighlightedExcerpt(excerpt);
    } else {
      setHighlightedExcerpt(null);
    }
  }, [citation, sourceContent]);

  useEffect(() => {
    if (open && highlightRef.current && scrollAreaRef.current) {
      const timer = setTimeout(() => {
        if (highlightRef.current) {
          const viewport = scrollAreaRef.current?.querySelector(
            '[data-radix-scroll-area-viewport]'
          ) as HTMLElement;
          
          if (viewport) {
            const highlightTop = highlightRef.current.offsetTop;
            const viewportHeight = viewport.clientHeight;
            const scrollTop = Math.max(0, highlightTop - viewportHeight / 3);
            
            viewport.scrollTo({
              top: scrollTop,
              behavior: 'smooth',
            });
          }
        }
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [open, highlightedExcerpt]);

  const handleJumpToChunk = useCallback(() => {
    if (citation?.chunk_index !== undefined && onJumpToChunk) {
      onJumpToChunk(citation.chunk_index);
    }
  }, [citation, onJumpToChunk]);

  if (!citation) return null;

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return '📄';
      case 'text':
        return '📝';
      case 'website':
        return '🌐';
      case 'youtube':
        return '📺';
      case 'audio':
        return '🎵';
      default:
        return '📄';
    }
  };

  const renderHighlightedContent = () => {
    if (!sourceContent) {
      return citation.excerpt ? (
        <p className="text-sm text-gray-700 leading-relaxed">{citation.excerpt}</p>
      ) : null;
    }

    const lines = sourceContent.split('\n');
    const startLine = citation.chunk_lines_from ?? 1;
    const endLine = citation.chunk_lines_to ?? lines.length;

    return (
      <div className="space-y-0">
        {lines.map((line, index) => {
          const lineNum = index + 1;
          const isHighlighted = lineNum >= startLine && lineNum <= endLine;
          const isFirstHighlighted = lineNum === startLine;

          return (
            <div
              key={index}
              className={`py-1 px-2 text-sm leading-relaxed transition-colors ${
                isHighlighted
                  ? 'bg-purple-100 border-l-4 border-purple-500'
                  : 'hover:bg-gray-50'
              }`}
            >
              <span
                ref={isFirstHighlighted ? highlightRef : undefined}
                className={isHighlighted ? 'text-gray-900' : 'text-gray-600'}
              >
                {line || '\u00A0'}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center space-x-2">
            <span className="text-xl">{getSourceIcon(citation.source_type)}</span>
            <span>{citation.source_title}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-center space-x-2 flex-wrap gap-2 flex-shrink-0">
            <Badge variant="outline" className="text-xs">
              Citation {citation.citation_id}
            </Badge>
            {citation.chunk_lines_from && citation.chunk_lines_to && (
              <Badge variant="outline" className="text-xs">
                Lines {citation.chunk_lines_from}-{citation.chunk_lines_to}
              </Badge>
            )}
            {highlightMatch && (
              <Badge 
                variant="outline" 
                className={`text-xs ${getConfidenceBadgeColor(highlightMatch.confidence)}`}
              >
                {Math.round(highlightMatch.confidence * 100)}% match
              </Badge>
            )}
            {citation.chunk_index !== undefined && onJumpToChunk && (
              <button
                onClick={handleJumpToChunk}
                className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
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
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                Jump to chunk {citation.chunk_index + 1}
              </button>
            )}
          </div>
          
          <div className="border-l-4 border-purple-500 pl-4 flex-1 min-h-0">
            <h4 className="font-medium text-gray-900 mb-2 flex-shrink-0">Source Content</h4>
            <ScrollArea className="h-64" ref={scrollAreaRef}>
              {renderHighlightedContent()}
            </ScrollArea>
          </div>

          {highlightedExcerpt && highlightMatch && (
            <div className="bg-gray-50 rounded-lg p-3 flex-shrink-0">
              <h5 className="text-xs font-medium text-gray-500 mb-2">Matched Text</h5>
              <p className="text-sm text-gray-700">
                <span className="text-gray-400">{highlightedExcerpt.contextBefore}</span>
                <span className="bg-yellow-200 px-0.5 rounded font-medium">
                  {highlightedExcerpt.matchedText.substring(0, 200)}
                  {highlightedExcerpt.matchedText.length > 200 && '...'}
                </span>
                <span className="text-gray-400">{highlightedExcerpt.contextAfter}</span>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function getConfidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.8) {
    return 'border-green-400 text-green-700 bg-green-50';
  } else if (confidence >= 0.5) {
    return 'border-yellow-400 text-yellow-700 bg-yellow-50';
  } else {
    return 'border-orange-400 text-orange-700 bg-orange-50';
  }
}

export default SourceViewer;
