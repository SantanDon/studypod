import React, { useState, useCallback } from 'react';
import { MessageSegment, Citation } from '@/types/message';
import { processMarkdownWithCitations } from './markdownParser';
import { motion, AnimatePresence } from 'framer-motion';

interface MarkdownRendererProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  className?: string;
  onCitationClick?: (citation: Citation) => void;
  isUserMessage?: boolean;
}

// Some model responses close a standalone bold label with one star. Repair only
// that unambiguous line shape, leaving prose, valid emphasis and code untouched.
export const normalizeAssistantMarkdown = (text: string): string => {
  let fence: { marker: string; length: number } | null = null;

  return text.split('\n').map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { marker: marker[0], length: marker.length };
      } else if (marker[0] === fence.marker && marker.length >= fence.length) {
        fence = null;
      }
      return line;
    }
    if (fence) return line;

    return line.replace(
      /^(\s*(?:(?:[-+*]|\d+[.)])\s+|#{1,6}\s+)?)\*\*([^*`\n]{1,100})\*(\s*)$/,
      (_match, prefix: string, label: string, suffix: string) =>
        label.trim() && !/\[\d+\]/.test(label) ? `${prefix}**${label}**${suffix}` : _match
    );
  }).join('\n');
};

const answerReadability = 'min-w-0 break-words [&>p]:text-[15px] [&>p]:leading-7 [&>p]:mb-4 [&>ul]:my-4 [&>ol]:my-4 [&>ul>li]:text-[15px] [&>ol>li]:text-[15px] [&>ul>li]:leading-7 [&>ol>li]:leading-7 [&>ul>li]:mb-2 [&>ol>li]:mb-2';

const FragmentComponent = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="my-3 rounded-xl border border-white/10 bg-white/5 overflow-hidden ring-1 ring-white/5 shadow-inner">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-white/5 hover:bg-white/10 transition-colors duration-200 text-left"
      >
        <span className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">{title}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} className="text-gray-500">▼</motion.span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-3 text-sm text-gray-400 leading-relaxed border-t border-white/5"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MarkdownRenderer = ({ content, className = '', onCitationClick, isUserMessage = false }: MarkdownRendererProps) => {
  const [hoveredCitation, setHoveredCitation] = useState<number | null>(null);

  const handleCitationHover = useCallback((index: number | null) => {
    setHoveredCitation(index);
  }, []);
  const containerClassName = `${isUserMessage ? 'min-w-0 break-words' : answerReadability} ${className}`.trim();

  const renderContent = (segments: MessageSegment[], citations: Citation[]) => {
    return segments.map((segment, idx) => {
      if (segment.type === 'fragment') {
        const match = segment.text.match(/\[FRAGMENT:\s*(.*?)\]([\s\S]*)/);
        if (match) {
          return <FragmentComponent key={idx} title={match[1]}>{match[2]}</FragmentComponent>;
        }
      }
      
      return (
        <React.Fragment key={idx}>
          {processMarkdownWithCitations(
            [isUserMessage ? segment : { ...segment, text: normalizeAssistantMarkdown(segment.text) }],
            citations, 
            onCitationClick, 
            isUserMessage,
            hoveredCitation,
            handleCitationHover
          )}
        </React.Fragment>
      );
    });
  };

  if (typeof content === 'object' && 'segments' in content) {
    return (
      <div className={containerClassName}>
        {renderContent(content.segments, content.citations)}
      </div>
    );
  }

  const textContent = typeof content === 'string' ? content : '';
  const segments: MessageSegment[] = [{ text: textContent }];
  const citations: Citation[] = [];
  
  return (
    <div className={containerClassName}>
      {renderContent(segments, citations)}
    </div>
  );
};

export default React.memo(MarkdownRenderer);
