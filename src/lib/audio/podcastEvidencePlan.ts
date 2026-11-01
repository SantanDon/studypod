/** Only complete supplied paragraphs can enter spoken evidence. Model output selects IDs, never narration. */
export interface EvidencePassage { id: string; text: string; sectionHeading?: string; sourceId?: string }

const normalizeSectionLabel = (value: string) => value.toLowerCase()
  .replace(/[’‘']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Recognize explicit section labels, never a phrase inside source prose. */
export function readPodcastSectionHeading(block: string): string | undefined {
  const text = block.trim();
  const marked = text.match(/^\[SECTION:\s*([^\]\n]{1,80})\]$/i);
  if (marked) return marked[1].trim();
  const heading = text.replace(/^#{1,6}\s+/, '').replace(/^[-—–]{2,}\s*|\s*[-—–]{2,}$/g, '').trim();
  if (!heading || heading.length > 80 || /\n/.test(heading)) return undefined;
  if (/^(?:introduction(?: and analysis)?|book\s+(?:[ivxlcdm]+|\d+)|chapter\s+(?:[ivxlcdm]+|\d+)|part\s+(?:[ivxlcdm]+|\d+))\.?$/i.test(heading)) return heading.replace(/\.$/, '');
  // A short title-shaped standalone label can delimit a named section. Lowercase
  // sentence fragments and punctuated prose are deliberately not headings.
  if (/^[\p{Lu}][\p{L}\p{M}'’:-]+(?:\s+(?:[\p{Lu}][\p{L}\p{M}'’:-]+|of|the|and|in|to|for)){0,9}$/u.test(heading)) return heading;
  return undefined;
}

/** Exact named-section focus only; this is not arbitrary topic retrieval. */
export function selectUniquePodcastSection(content: string, focus?: string): {heading: string; content: string} | undefined {
  const requested = normalizeSectionLabel(focus || '');
  if (!requested) return undefined;
  const blocks = content.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const sections: Array<{heading: string; body: string[]}> = [];
  let active: typeof sections[number] | undefined;
  for (const block of blocks) {
    const heading = readPodcastSectionHeading(block);
    if (heading) {
      // EPUB extraction can repeat a decorated label immediately as plain text.
      if (active && !active.body.length && normalizeSectionLabel(active.heading) === normalizeSectionLabel(heading)) continue;
      active = {heading, body: []};
      sections.push(active);
    } else if (active && block.trim()) active.body.push(block.trim());
  }
  const matches = sections.filter(section => {
    const label = normalizeSectionLabel(section.heading);
    return label.split(' ').length >= 2 && (` ${requested} `).includes(` ${label} `);
  });
  if (matches.length !== 1 || !matches[0].body.length) return undefined;
  const {heading, body} = matches[0];
  return {heading, content: `[SECTION: ${heading}]\n\n${body.join('\n\n')}`};
}

// Only repair known whole words; a blanket hyphen/whitespace replacement would
// silently change intentional compounds such as "well-\nbeing" or "re-creation".
const PDF_JOINED_WORDS = new Set([
  'dialogues', 'especially', 'metaphysical', 'distinction', 'discovered', 'political',
  'navigators', 'freedom', 'goodly', 'renaissance', 'writings', 'literature', 'politics',
  'abstraction', 'conception', 'intellectual', 'quarrel', 'divisions', 'adeimantus',
  'popular', 'restatement', 'second', 'subject', 'reviewed', 'determined', 'opposed',
  'structure', 'inconsistencies', 'generally', 'occur', 'general', 'descriptions',
  'plastic', 'escaped', 'advantage', 'questions', 'attic', 'defending', 'certainly',
  'dialectic', 'elicits', 'complete', 'argument', 'regarded', 'socrates', 'carries',
  'imaginative', 'morality', 'followed', 'distinguished', 'memorabilia',
]);

function normalizePodcastPdfWrapping(text: string): string {
  return text.replace(/\u00ad(?:[ \t]*\n[ \t]*)?/g, '')
    .replace(/\b([A-Za-z]+)-\s+([A-Za-z]+)\b/g, (original, left: string, right: string) => {
      const joined = left + right;
      return PDF_JOINED_WORDS.has(joined.toLowerCase()) ? joined : original;
    });
}

function hasClearContinuationStart(text: string): boolean {
  // An abbreviated citation with a closing parenthesis but no opening one is
  // the severed tail of a preceding clause, not a self-contained reading.
  if (/^(?=[^\n()]{1,100}\))(?=[^\n()]*\b[A-Z][a-z]{1,10}\.)(?=[^\n()]*;)[\p{L}\d.,;:\s-]{1,100}\)/u.test(text)) return true;
  // PDF page breaks can separate the start of a sentence from a short quoted
  // continuation (e.g. "’shut him up.’ He has reached..."). Omit, never rewrite.
  return /^[’'][a-z][^’'\n]{1,100}[.!?][’']\s+[A-Z]/u.test(text);
}

/** Remove only the publisher/page-number token found in the Plato PDF extraction. */
function removeIdphPageMarkers(line: string): string {
  const pageMarker = String.raw`(?:\d{1,4}\s+IDPH|IDPH\s+\d{1,4})`;
  if (new RegExp(String.raw`^\s*${pageMarker}(?:\s+https?:\/\/\S+)?\s*$`, 'i').test(line)) return '';
  // A page-start marker followed by lowercase prose is usually the tail of a
  // sentence that began on the preceding PDF page. It cannot stand alone as a
  // complete evidence passage, so omit this extracted line instead of
  // presenting a misleading mid-sentence start.
  const pageStartContinuation = line.match(new RegExp(String.raw`^\s*${pageMarker}\s+(.+)$`, 'i'));
  if (pageStartContinuation && /^[a-z]/.test(pageStartContinuation[1].trim())) return '';
  // The PDF text layer sometimes joins a page marker to the first line of prose.
  // Remove that exact publisher/number pair and retain every following source word.
  return line.replace(new RegExp(String.raw`\b${pageMarker}\b`, 'ig'), '').replace(/[ \t]{2,}/g, ' ').trim();
}

export function isLikelyNonSubstantiveFrontMatter(passage: string): boolean {
  const lines = passage.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || passage.length > 2500) return false;

  // Treat only a whole block made of page-number-shaped entries as a contents
  // list. If prose shares the paragraph with the list, keep that complete source
  // passage rather than slicing away lines that may belong to a wrapped sentence.
  const startsWithContentsLabel = /^\s*(?:table\s+of\s+contents|contents|sum[aá]rio|índice|index)\b\s*:?[ \t]*$/i.test(lines[0]);
  const entries = lines.slice(startsWithContentsLabel ? 1 : 0);
  const isPageEntry = (line: string) => /[\p{L}\p{M}]{2,}[^.!?]{0,100}\s+\d{1,4}\s*$/u.test(line);
  if (startsWithContentsLabel && entries.length >= 3 && entries.every(isPageEntry)) return true;
  if (!startsWithContentsLabel && lines.length >= 3 && lines.every(isPageEntry)) return true;

  // Some PDF extractors flatten the contents label and all entries into one
  // line. Only classify that shape when the remainder is all-uppercase,
  // punctuation-free heading text with at least three page-number entries;
  // ordinary mixed-case or sentence-like prose stays eligible as evidence.
  const flattenedContents = lines.length === 1
    ? lines[0].match(/^\s*(?:table\s+of\s+contents|contents|sum[aá]rio|índice|index)\b\s*:?\s+(.+)$/iu)
    : null;
  const flattenedEntries = flattenedContents?.[1].trim();
  if (flattenedEntries
    && flattenedEntries === flattenedEntries.toLocaleUpperCase()
    && !/[.!?]/.test(flattenedEntries)
    && (flattenedEntries.match(/\b\d{1,4}\b/g)?.length ?? 0) >= 3) return true;

  // PDF headers/footers and source-card metadata are common short first
  // paragraphs. Require recognizable page-furniture / metadata shape so dated
  // prose or numeric findings are not dropped just for containing numbers.
  const pageFurniture = lines.every(line =>
    /^\d{1,4}\s+[A-Z][A-Z0-9 &.-]{1,32}(?:\s+https?:\/\/\S+)?$/i.test(line),
  );
  if (pageFurniture) return true;

  const hasUrl = lines.some(line => /https?:\/\//i.test(line));
  // Dots inside a URL are not sentence punctuation. Source cards commonly
  // flatten title, URL, and publication date onto one line.
  const withoutUrls = (line: string) => line.replace(/https?:\/\/\S+/gi, ' ');
  const isPageFurnitureLine = (line: string) => /^\d{1,4}\s+[A-Z][A-Z0-9 &.-]{1,32}(?:\s+https?:\/\/\S+)?$/i.test(line);
  const metadataLines = lines.every((line, index) =>
    /^(?:https?:\/\/\S+|(?:date|published|updated|copyright|author|title|source)\s*:\s*\S.*|(?:19|20)\d{2}(?:[-/][0-9A-Za-z]+)*|\d{1,2}\s+[\p{L}]+\s+\d{4})$/iu.test(line)
      || isPageFurnitureLine(line)
      || (hasUrl && index === 0 && !/[.!?]/.test(withoutUrls(line)) && line.split(/\s+/).length <= 10),
  );
  if (hasUrl && metadataLines) return true;

  // Exclude recognizable structural labels and standalone publisher cards,
  // while retaining short unpunctuated source prose whose completeness cannot
  // be inferred from punctuation alone.
  const normalized = lines.join(' ').replace(/[—–-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:opening credits and front matter|introduction and analysis|book\s+(?:[ivxlcdm]+|\d+)|end of this project gutenberg etext\b.*|also see the republic by plato\b.*)$/i.test(normalized)) return true;
  if (/^\d{1,4}$/.test(normalized)) return true;
  const titleCard = lines.length === 1 && lines[0].length <= 100 && !/[.!?]/.test(lines[0])
    && /^(?:the\s+)?[\p{Lu}][\p{L}\p{M}'’:-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’:-]+){0,5}$/u.test(lines[0]);
  return titleCard;
}

export function indexPodcastEvidence(content: string, budget = 12000, focus?: string) {
  const passages: EvidencePassage[] = [];
  let used = 0;
  let omitted = /^COVERAGE: partial;/m.test(content);
  // A positional excerpt can sever the clause containing a qualification. Fail closed.
  if (/\[(?:\.\.\.\s*excerpt gap|focused excerpt;|Excerpt unavailable)/i.test(content)) {
    throw new Error('Podcast evidence contains incomplete excerpts. Select a shorter source or complete passage before generating audio.');
  }
  // Source-labelled contexts were already scoped before budgeting. Re-scoping
  // their section blocks here could discard the origin header and its IDs.
  const focusedSection = /^SOURCE_ID:/m.test(content) ? undefined : selectUniquePodcastSection(content, focus);
  if (focusedSection) omitted = true;
  const blocks = (focusedSection?.content || content).replace(/\r\n/g, '\n').split(/\n\s*\n/);
  let sectionHeading: string | undefined;
  let sourceId: string | undefined;
  for (const block of blocks) {
    const lines = block.split('\n').map(removeIdphPageMarkers);
    const body: string[] = [];
    for (const line of lines) {
      if (/^SOURCE:/.test(line)) { sourceId = undefined; sectionHeading = undefined; }
      if (/^SOURCE_ID:/.test(line)) {
        try {
          const id: unknown = JSON.parse(line.slice('SOURCE_ID:'.length).trim());
          sourceId = typeof id === 'string' && id ? id : undefined;
        } catch { sourceId = undefined; }
        continue;
      }
      if (/^(?:SOURCE|STRUCTURE|COVERAGE):/.test(line)) continue;
      const heading = line.match(/^\[SECTION:\s*([^\]]{1,80})\]\s*$|^\[((?:Source|Opening|BOOK\s[^\]]*|CHAPTER\s[^\]]*|PART\s[^\]]*|INTRODUCTION[^\]]*))\]\s*$/i);
      if (heading) {
        sectionHeading = (heading[1] || heading[2]).trim();
        continue;
      }
      body.push(line);
    }
    const text = normalizePodcastPdfWrapping(body.join('\n').trim());
    if (!text) continue;
    if (hasClearContinuationStart(text)) { omitted = true; continue; }
    // A bare terminal page number can be fused to a word or separated by
    // whitespace. When the block has no sentence-ending punctuation, its final
    // prose is incomplete; omit the entire block instead of stripping the
    // number or speaking a clipped sentence. Punctuated numeric sentences stay
    // eligible (for example, "There are 5.").
    if (/\d{1,4}\s*$/u.test(text)
      && !/[.!?]["')\]]?\s*$/u.test(text)
      && /[.!?]/u.test(text.replace(/\d{1,4}\s*$/u, ''))) {
      omitted = true;
      continue;
    }
    // Do not split a paragraph: qualifiers and a planned/result distinction must remain together.
    if (text.length > 4000 || used + text.length > budget || passages.length >= 60) { omitted = true; continue; }
    const id = `p${passages.length + 1}`;
    passages.push({id, text, ...(sectionHeading ? {sectionHeading} : {}), ...(sourceId ? {sourceId} : {})});
    used += text.length;
  }
  if (!passages.length) throw new Error('No complete source passages fit the podcast budget. Select a shorter source or complete passage.');
  return {passages, budgetedChars: used, excerpted: omitted};
}
export function compilePodcastEvidence(response: string, passages: EvidencePassage[], host1: string, host2: string, solo: boolean, type: 'brief' | 'standard' | 'deep-dive', ceiling: number) {
  let value: unknown;
  const fenced = response.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  try { value = JSON.parse(fenced ? fenced[1] : response.trim()); }
  catch { throw new Error('Provider output was not valid episode JSON. Expected a passageIds evidence plan.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid podcast evidence plan.');
  const plan = value as Record<string, unknown>;
  if (Object.keys(plan).length !== 1 || !Array.isArray(plan.passageIds) || !plan.passageIds.length || plan.passageIds.length > 60) {
    throw new Error('Invalid podcast evidence plan: only a nonempty passageIds array is accepted; model-written narration is forbidden.');
  }
  const ids = plan.passageIds;
  if (ids.some(id => typeof id !== 'string' || !passages.some(p => p.id === id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid podcast evidence plan: unknown or duplicate passage ID.');
  }
  const selected = passages.filter(p => ids.includes(p.id) && !isLikelyNonSubstantiveFrontMatter(p.text)); // Preserve source order even if the plan reverses it.
  if (!selected.length) throw new Error('The selected passages contain only navigation or PDF front matter, not source prose. Select a complete narrative passage.');
  const second = solo ? host1 : host2;
  const segments: Array<{speaker: string; text: string}> = [];
  if (type === 'brief') {
    segments.push({speaker: host1, text: 'Here are a few selected passages from the source, not the full source.'});
    for (const passage of selected) segments.push({speaker: host1, text: passage.text});
    segments.push({speaker: second, text: 'What do these passages say, and what remains unclear?'});
  } else if (type === 'standard') {
    segments.push({speaker: host1, text: 'We’ll read selected passages in order. Listen for what they say and what remains unclear.'});
    for (const [index, passage] of selected.entries()) {
      segments.push({speaker: second, text: `Passage ${index + 1}.`});
      segments.push({speaker: host1, text: passage.text});
      if (index === selected.length - 1) segments.push({speaker: second, text: 'What does it say? What remains unclear?'});
    }
  } else {
    segments.push({speaker: host1, text: 'We’ll read selected sections in order. This covers only the passages chosen, not the full source.'});
    let lastHeading: string | undefined;
    const listeningPrompts = [
      'What is the main point? What qualifies it?',
      'What evidence is given? What is missing?',
      'What can we conclude from these words?',
    ];
    // Pause after reading groups, at most once per prompt, rather than repeating
    // the same generic questions after every paragraph in a long episode.
    const promptCount = Math.min(listeningPrompts.length, selected.length);
    const promptPositions = new Map(Array.from({length: promptCount}, (_, index) => [
      Math.ceil((index + 1) * selected.length / promptCount) - 1, listeningPrompts[index],
    ]));
    for (const [index, passage] of selected.entries()) {
      if (passage.sectionHeading && passage.sectionHeading !== lastHeading) {
        segments.push({speaker: second, text: `Let’s turn to ${passage.sectionHeading}.`});
        lastHeading = passage.sectionHeading;
      } else if (!passage.sectionHeading && index === 0) {
        segments.push({speaker: second, text: 'Let’s start with this passage.'});
      }
      const location = passage.sectionHeading ? `${passage.sectionHeading}, passage ${index + 1}` : `Passage ${index + 1}`;
      segments.push({speaker: second, text: `${location}.`});
      segments.push({speaker: host1, text: passage.text});
      const prompt = promptPositions.get(index);
      if (prompt) segments.push({speaker: second, text: prompt});
    }
  }
  segments.push({speaker: host1, text: 'For the full context, read the source.'});
  const words = segments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0);
  if (words > ceiling) throw new Error(`The selected complete passages and framing total ${words} words, above the ${ceiling}-word podcast depth limit. Select fewer complete passages or a greater depth; nothing was truncated.`);
  return {title: 'Guided source discussion', segments, words, evidencePassageIds: selected.map(p => p.id),
    evidenceSourceIds: [...new Set(selected.flatMap(p => p.sourceId ? [p.sourceId] : []))]};
}
