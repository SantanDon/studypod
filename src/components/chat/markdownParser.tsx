import React from 'react';
import CitationButton from './CitationButton';
import LiquidCitation from './LiquidCitation';
import { Citation, MessageSegment } from '@/types/message';

const INLINE_TOKEN = /(`+)([^`\n]*?)\1|\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|(?<!\*)\*(?!\*)(?=\S)([^*\n]+?)(?<=\S)(?<!\*)\*|\[(\d+)\]/g;

const findCitation = (citations: Citation[], number: number) => citations.find(
  citation => citation.citation_id === number || citation.chunk_index === number - 1
);

const renderInline = (
  text: string,
  citations: Citation[] = [],
  keyPrefix = 'inline',
  onCitationClick?: (citation: Citation) => void
): React.ReactNode[] => {
  const output: React.ReactNode[] = [];
  const tokenPattern = new RegExp(INLINE_TOKEN.source, 'g');
  let offset = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > offset) output.push(text.slice(offset, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) output.push(<code key={key} className="rounded bg-slate-500/10 px-1">{match[2]}</code>);
    else if (match[3] !== undefined) output.push(<strong key={key}>{renderInline(match[3], citations, key, onCitationClick)}</strong>);
    else if (match[4] !== undefined) output.push(<strong key={key}>{renderInline(match[4], citations, key, onCitationClick)}</strong>);
    else if (match[5] !== undefined) output.push(<em key={key}>{renderInline(match[5], citations, key, onCitationClick)}</em>);
    else if (match[6]) {
      const citationNumber = Number(match[6]);
      const citation = findCitation(citations, citationNumber);
      output.push(citation
        ? <LiquidCitation key={key} index={citationNumber} citation={citation} triggerType="hover" onCitationClick={onCitationClick} />
        : match[0]);
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) output.push(text.slice(offset));
  return output;
};

export const processInlineMarkdown = (text: string) => renderInline(text).map((node, index) =>
  typeof node === 'string' ? node.replace(/\n/g, ' ') : React.cloneElement(node as React.ReactElement, { key: index })
);

export const processTextWithMarkdown = (text: string) => renderInline(text);

export const processTextWithMarkdownAndCitations = (
  text: string,
  citations: Citation[],
  _onCitationClick?: (citation: Citation) => void,
  _hoveredCitation?: number | null,
  _onHover?: (index: number | null) => void
): (string | JSX.Element)[] => renderInline(text, citations) as (string | JSX.Element)[];

const renderBlockQuote = (lines: string[], citations: Citation[], key: string, onCitationClick?: (citation: Citation) => void) => {
  const quoteLines = lines.map(line => line.replace(/^\s*>\s?/, '').trim()).filter(Boolean);
  return <blockquote key={key} className="my-3 border-l-2 border-slate-400/60 pl-3 text-slate-600 dark:text-slate-300">
    {quoteLines.map((line, index) => <p key={index}>{renderInline(line, citations, `${key}-${index}`, onCitationClick)}</p>)}
  </blockquote>;
};

export const processMarkdownWithCitations = (
  segments: MessageSegment[],
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void,
  isUserMessage: boolean = false,
  _hoveredCitation?: number | null,
  _onHover?: (index: number | null) => void
) => {
  if (isUserMessage) return <span>{segments.map((segment, index) => {
    const citation = segment.citation_id ? citations.find(item => item.citation_id === segment.citation_id) : undefined;
    return <span key={index}>{processInlineMarkdown(segment.text)}{citation && onCitationClick && <CitationButton chunkIndex={citation.chunk_index || 0} onClick={() => onCitationClick(citation)} />}</span>;
  })}</span>;

  const elements: JSX.Element[] = [];
  segments.forEach((segment, segmentIndex) => {
    const lines = segment.text.replace(/\r\n?/g, '\n').split('\n');
    const blocks: string[][] = [];
    let current: string[] = [];
    let inFence = false;
    lines.forEach((line, index) => {
      if (/^\s*(```+|~~~+)/.test(line)) inFence = !inFence;
      if (!line.trim() && !inFence) {
        const previous = current[current.length - 1]?.trim() || '';
        const next = lines.slice(index + 1).find(candidate => candidate.trim())?.trim() || '';
        const previousList = previous.match(/^(?:[-+*]|\d+[.)])\s+/)?.[0]?.replace(/\s+$/, '');
        const nextList = next.match(/^(?:[-+*]|\d+[.)])\s+/)?.[0]?.replace(/\s+$/, '');
        if (previousList && nextList && (previousList[0] === nextList[0] || /^\d/.test(previousList) && /^\d/.test(nextList))) return;
        if (current.length) blocks.push(current);
        current = [];
      } else current.push(line);
    });
    if (current.length) blocks.push(current);

    const segmentCitation = segment.citation_id
      ? citations.find(item => item.citation_id === segment.citation_id)
      : undefined;
    const citationButton = (atSegmentEnd: boolean) => atSegmentEnd && segmentCitation && onCitationClick
      ? <CitationButton chunkIndex={segmentCitation.chunk_index || 0} onClick={() => onCitationClick(segmentCitation)} />
      : null;

    blocks.forEach((block, blockIndex) => {
      const blockKey = `${segmentIndex}-${blockIndex}`;
      let lineIndex = 0;
      while (lineIndex < block.length) {
        const line = block[lineIndex].trim();
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const Tag = `h${level}` as keyof JSX.IntrinsicElements;
          elements.push(<Tag key={`${blockKey}-heading-${lineIndex}`} className={level <= 2 ? 'text-base font-semibold text-slate-800 dark:text-slate-100 my-3' : 'text-sm font-semibold text-slate-700 dark:text-slate-200 my-2'}>{renderInline(heading[2], citations, blockKey, onCitationClick)}{citationButton(blockIndex === blocks.length - 1 && lineIndex === block.length - 1)}</Tag>);
          lineIndex++;
          continue;
        }

        if (/^\s*>/.test(block[lineIndex])) {
          const quote: string[] = [];
          while (lineIndex < block.length && /^\s*>/.test(block[lineIndex])) quote.push(block[lineIndex++]);
          elements.push(<React.Fragment key={`${blockKey}-quote-fragment-${lineIndex}`}>{renderBlockQuote(quote, citations, `${blockKey}-quote-${lineIndex}`, onCitationClick)}{citationButton(blockIndex === blocks.length - 1 && lineIndex === block.length)}</React.Fragment>);
          continue;
        }

        if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
          const fence = line.match(/^\s*(```+|~~~+)/)![1];
          const codeLines: string[] = [];
          lineIndex++;
          while (lineIndex < block.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(block[lineIndex])) codeLines.push(block[lineIndex++]);
          if (lineIndex < block.length) lineIndex++;
          elements.push(<pre key={`${blockKey}-code-${lineIndex}`} className="my-3 overflow-x-auto rounded bg-slate-900/5 p-3 dark:bg-slate-100/5"><code>{codeLines.join('\n')}</code></pre>);
          continue;
        }

        const listMatch = line.match(/^\s*([-+*])\s+(.+)$/) || line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (listMatch) {
          const ordered = /^\d/.test(listMatch[1]);
          const items: JSX.Element[] = [];
          while (lineIndex < block.length) {
            const currentLine = block[lineIndex].trim();
            const item = currentLine.match(/^([-+*])\s+(.+)$/) || currentLine.match(/^(\d+)[.)]\s+(.+)$/);
            if (!item || /^\d/.test(item[1]) !== ordered) break;
            items.push(<li key={`${blockKey}-item-${lineIndex}`} className="mb-1 leading-relaxed text-sm">{renderInline(item[2], citations, `${blockKey}-${lineIndex}`, onCitationClick)}</li>);
            lineIndex++;
          }
          const List = ordered ? 'ol' : 'ul';
          const listStart = ordered ? Number(listMatch[1]) : undefined;
          if (blockIndex === blocks.length - 1 && lineIndex === block.length && citationButton(true)) {
            items[items.length - 1] = React.cloneElement(items[items.length - 1], {}, items[items.length - 1].props.children, citationButton(true));
          }
          elements.push(<List key={`${blockKey}-list-${lineIndex}`} start={listStart} className={`${ordered ? 'list-decimal' : 'list-disc'} my-3 space-y-1.5 pl-6 text-slate-700 dark:text-slate-100`}>{items}</List>);
          continue;
        }

        const paragraph: string[] = [];
        while (lineIndex < block.length && !/^(#{1,6})\s+/.test(block[lineIndex].trim()) && !/^\s*>/.test(block[lineIndex]) && !/^\s*```/.test(block[lineIndex]) && !/^\s*~~~/.test(block[lineIndex]) && !/^\s*([-+*])\s+/.test(block[lineIndex]) && !/^\s*\d+[.)]\s+/.test(block[lineIndex].trim())) paragraph.push(block[lineIndex++].trim());
        if (paragraph.length === 0) paragraph.push(block[lineIndex++].trim());
        elements.push(<p key={`${blockKey}-p-${lineIndex}`} className="mb-2.5 leading-relaxed text-slate-700 dark:text-slate-100 text-sm">{paragraph.map((part, index) => <React.Fragment key={index}>{index > 0 && ' '}{renderInline(part, citations, `${blockKey}-p`, onCitationClick)}</React.Fragment>)}{citationButton(blockIndex === blocks.length - 1 && lineIndex >= block.length)}</p>);
      }
    });
  });
  return elements;
};

export const renderTextWithCitationMarkers = (
  text: string,
  citations: Citation[],
  _onCitationClick?: (citation: Citation) => void,
  _hoveredCitation?: number | null,
  _onHover?: (index: number | null) => void
): React.ReactNode => <>{renderInline(text, citations)}</>;
