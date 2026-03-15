import React, { useState, useCallback } from 'react';
import { MessageSegment, Citation } from '@/types/message';
import { extractCitations } from '@/lib/citations/citationManager';
import { processMarkdownWithCitations } from './markdownParser';

interface MarkdownRendererProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  className?: string;
  onCitationClick?: (citation: Citation) => void;
  isUserMessage?: boolean;
}

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
    const segments: MessageSegment[] = [{ text: textContent }];
    return (
      <div className={className}>
        {processMarkdownWithCitations(
          segments, 
          [], 
          onCitationClick, 
          isUserMessage,
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

export default MarkdownRenderer;
