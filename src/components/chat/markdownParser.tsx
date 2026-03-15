import React from 'react';
import { MessageSegment, Citation } from '@/types/message';
import CitationButton from './CitationButton';
import { CitationBadge } from './CitationBadge';

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

export const processInlineMarkdown = (text: string) => {
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

export const processTextWithMarkdown = (text: string) => {
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

export const processTextWithMarkdownAndCitations = (
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

export const processMarkdownWithCitations = (
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

  const elements: JSX.Element[] = [];
  
  segments.forEach((segment, segmentIndex) => {
    const citation = segment.citation_id ? citations.find(c => c.citation_id === segment.citation_id) : undefined;
    
    // Preprocess: insert line breaks before heading markers that appear mid-text
    // Only handle heading markers (## ###) — don't preprocess bullets/lists as it breaks **bold** markers
    let preprocessed = segment.text;
    // Insert \n before ## or ### that follow sentence-ending punctuation or text (not already at start of line)
    preprocessed = preprocessed.replace(/([.!?:;])\s*(#{1,3}\s)/g, '$1\n$2');
    // Also handle heading markers that follow a closing bold marker
    preprocessed = preprocessed.replace(/(\*\*)\s*(#{1,3}\s)/g, '$1\n$2');
    
    // Split into blocks by double newlines
    const blocks = preprocessed.split('\n\n').filter(text => text.trim());
    
    blocks.forEach((block, blockIndex) => {
      const lines = block.split('\n');
      let i = 0;
      
      while (i < lines.length) {
        const line = lines[i].trim();
        
        // Skip empty lines and lone ** markers (artifacts from LLM formatting)
        if (line === '' || line === '**' || line === '*') {
          i++;
          continue;
        }
        
        // Skip bare heading markers on their own line (e.g., "##" or "###" with no text)
        // These are artifacts from LLM formatting — treat next non-empty line as the heading
        if (/^#{1,3}$/.test(line)) {
          // Look ahead for the heading text on the next line
          const nextI = i + 1;
          if (nextI < lines.length && lines[nextI].trim().length > 0) {
            const headingText = lines[nextI].trim();
            const level = line.length; // 1, 2, or 3
            const className = level === 1 
              ? "font-bold text-lg text-gray-900 mt-4 mb-2"
              : level === 2
                ? "font-bold text-base text-gray-900 mt-4 mb-2"
                : "font-semibold text-sm text-gray-900 mt-3 mb-1.5";
            const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
            elements.push(
              <Tag key={`${segmentIndex}-${blockIndex}-${i}`} className={className}>
                {processTextWithMarkdownAndCitations(headingText, citations, onCitationClick, hoveredCitation, onHover)}
              </Tag>
            );
            i = nextI + 1;
            continue;
          }
          // If no next line, skip the bare marker
          i++;
          continue;
        }
        
        // Heading detection: ## or ###
        if (line.startsWith('### ')) {
          const headingText = line.replace(/^###\s+/, '');
          elements.push(
            <h4 key={`${segmentIndex}-${blockIndex}-${i}`} className="font-semibold text-sm text-gray-900 mt-3 mb-1.5">
              {processTextWithMarkdownAndCitations(headingText, citations, onCitationClick, hoveredCitation, onHover)}
            </h4>
          );
          i++;
          continue;
        }
        
        if (line.startsWith('## ')) {
          const headingText = line.replace(/^##\s+/, '');
          elements.push(
            <h3 key={`${segmentIndex}-${blockIndex}-${i}`} className="font-bold text-base text-gray-900 mt-4 mb-2">
              {processTextWithMarkdownAndCitations(headingText, citations, onCitationClick, hoveredCitation, onHover)}
            </h3>
          );
          i++;
          continue;
        }
        
        if (line.startsWith('# ')) {
          const headingText = line.replace(/^#\s+/, '');
          elements.push(
            <h2 key={`${segmentIndex}-${blockIndex}-${i}`} className="font-bold text-lg text-gray-900 mt-4 mb-2">
              {processTextWithMarkdownAndCitations(headingText, citations, onCitationClick, hoveredCitation, onHover)}
            </h2>
          );
          i++;
          continue;
        }
        
        // Bullet list detection: - or *
        if (/^[-*]\s+/.test(line)) {
          const listItems: JSX.Element[] = [];
          while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
            const itemText = lines[i].trim().replace(/^[-*]\s+/, '');
            listItems.push(
              <li key={`li-${i}`} className="mb-1.5 leading-relaxed text-gray-700">
                {processTextWithMarkdownAndCitations(itemText, citations, onCitationClick, hoveredCitation, onHover)}
              </li>
            );
            i++;
          }
          elements.push(
            <ul key={`${segmentIndex}-${blockIndex}-ul-${i}`} className="list-disc pl-5 my-2 space-y-0.5">
              {listItems}
            </ul>
          );
          continue;
        }
        
        // Numbered list detection: 1. 2. etc.
        if (/^\d+[.)]\s+/.test(line)) {
          const listItems: JSX.Element[] = [];
          while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
            const itemText = lines[i].trim().replace(/^\d+[.)]\s+/, '');
            listItems.push(
              <li key={`li-${i}`} className="mb-1.5 leading-relaxed text-gray-700">
                {processTextWithMarkdownAndCitations(itemText, citations, onCitationClick, hoveredCitation, onHover)}
              </li>
            );
            i++;
          }
          elements.push(
            <ol key={`${segmentIndex}-${blockIndex}-ol-${i}`} className="list-decimal pl-5 my-2 space-y-0.5">
              {listItems}
            </ol>
          );
          continue;
        }
        
        // Regular paragraph
        if (line.length > 0) {
          const processedContent = processTextWithMarkdownAndCitations(
            line,
            citations,
            onCitationClick,
            hoveredCitation,
            onHover
          );
          
          const isLastLine = blockIndex === blocks.length - 1 && i === lines.length - 1;
          
          elements.push(
            <p key={`${segmentIndex}-${blockIndex}-${i}`} className="mb-3 leading-relaxed text-gray-800">
              {processedContent}
              {isLastLine && citation && onCitationClick && (
                <CitationButton
                  chunkIndex={citation.chunk_index || 0}
                  onClick={() => onCitationClick(citation)}
                />
              )}
            </p>
          );
        }
        
        i++;
      }
    });
  });
  
  return elements;
};

export const renderTextWithCitationMarkers = (
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
