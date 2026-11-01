/** Deterministic guard for explicit source-grounded quote requests. */
export function getQuoteGroundingIssue(
  question: string,
  answer: string,
  sources: Array<{ content: string }>,
): string | null {
  if (!isExplicitQuoteRequest(question)) return null;

  const paragraphs = answer.split(/\n\s*\n/);
  const quotes = extractVisibleQuotes(paragraphs);
  if (quotes.length === 0) {
    return canHonestlyAbstain(answer)
      ? null
      : 'An exact quote was requested, but the answer contains no visibly quoted passage.';
  }

  let missingCitation = false;
  let unsupportedQuote = false;
  for (const quote of quotes) {
    const relevantText = [paragraphs[quote.paragraphIndex], paragraphs[quote.paragraphIndex + 1] || ''].join('\n');
    const citedSourceNumbers = [...relevantText.matchAll(/\[(\d+)\]/g)]
      .map((match) => Number(match[1]));
    if (citedSourceNumbers.length === 0) {
      missingCitation = true;
      continue;
    }
    let verified = false;
    for (const sourceNumber of citedSourceNumbers) {
      const source = sources[sourceNumber - 1];
      if (source && normalizeQuotedText(source.content).includes(normalizeQuotedText(quote.text))) {
        verified = true;
        break;
      }
    }
    if (!verified) unsupportedQuote = true;
  }

  if (!missingCitation && !unsupportedQuote) return null;
  return unsupportedQuote
    ? 'The quoted passage could not be verified as an exact substring of the cited source.'
    : 'The quoted passage needs a source-number citation such as [1] in the same or following paragraph.';
}

function isExplicitQuoteRequest(question: string): boolean {
  return /\b(?:exact|verbatim|memorable)\b.{0,60}\bquotes?\b/i.test(question)
    || /\bquotes?\b.{0,60}\b(?:exact|verbatim|memorable)\b/i.test(question)
    || /\bsource[- ]verified\b.{0,60}\bquotes?\b/i.test(question)
    || /\bquotes?\b.{0,60}\b(?:source[- ]verified|citations?|cite)\b/i.test(question);
}

function canHonestlyAbstain(answer: string): boolean {
  return /\b(?:cannot|can't|could not|couldn't|unable to)\b.{0,80}\bverify\b.{0,50}\b(?:exact wording|exact quote|quotation|passage)\b/i.test(answer)
    || /\b(?:cannot|can't|could not|couldn't|unable to)\b.{0,80}\b(?:exact wording|exact quote|quotation)\b/i.test(answer);
}

type VisibleQuote = { text: string; paragraphIndex: number };

function extractVisibleQuotes(paragraphs: string[]): VisibleQuote[] {
  const quotes: VisibleQuote[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const lines = paragraph.split('\n');
    const blockquoteIndexes = new Set<number>();
    let blockquoteLines: string[] = [];
    const flushBlockquote = () => {
      if (blockquoteLines.length === 0) return;
      const contentLines = blockquoteLines
        .map((line) => line.replace(/^\s*>\s?/, '').trim())
        .filter((line) => line && !/^\[\d+\]$/.test(line));
      if (contentLines.length > 1 && /^[—–-]\s*[^.!?]{1,80}$/.test(contentLines.at(-1) || '')) {
        contentLines.pop();
      }
      const blockquote = stripOuterQuoteMarks(contentLines.join(' ').replace(/\[\d+\]/g, '').trim());
      if (blockquote.length >= 15) quotes.push({ text: blockquote, paragraphIndex });
      blockquoteLines = [];
    };

    lines.forEach((line, lineIndex) => {
      if (/^\s*>/.test(line)) {
        blockquoteIndexes.add(lineIndex);
        blockquoteLines.push(line);
      } else {
        flushBlockquote();
      }
    });
    flushBlockquote();

    const inlineQuote = /“([^”]{15,})”|"([^"\n]{15,})"/g;
    lines.forEach((line, lineIndex) => {
      if (blockquoteIndexes.has(lineIndex)) return;
      for (const match of line.matchAll(inlineQuote)) {
        const text = (match[1] ?? match[2] ?? '').trim();
        if (text.length >= 15) quotes.push({ text, paragraphIndex });
      }
    });
  });
  return quotes;
}

function stripOuterQuoteMarks(value: string): string {
  return value.replace(/^[“"']([\s\S]*)[”"']$/, '$1').trim();
}

function normalizeQuotedText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
