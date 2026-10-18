export interface PodcastContextSource {
  id?: string;
  title?: string;
  content?: string | null;
  metadata?: unknown;
}

interface BuildPodcastContextOptions {
  focus?: string;
  maxChars?: number;
}

type Section = {
  heading: string;
  text: string;
};

const MAJOR_HEADING =
  /(?:^|\n)\s*((?:BOOK\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|\d+))|(?:CHAPTER\s+\d+)|(?:PART\s+(?:I|II|III|IV|V|\d+))|(?:INTRODUCTION(?:\s+AND\s+ANALYSIS)?))\s*(?:\n|$)/gi;

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const focusTokens = (focus: string) =>
  [...new Set(normalize(focus).split(/\s+/).filter((token) => token.length > 2))];

function splitMajorSections(content: string): Section[] {
  const matches = [...content.matchAll(MAJOR_HEADING)];
  if (matches.length < 2) {
    return [{ heading: "Source", text: content.trim() }];
  }

  const sections: Section[] = [];
  const prefix = content.slice(0, matches[0].index).trim();
  if (prefix) sections.push({ heading: "Opening", text: prefix });

  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    sections.push({
      heading: match[1].trim(),
      text: content.slice(start, end).trim(),
    });
  });

  return sections.filter((section) => section.text.length > 0);
}

function relevantWindow(text: string, tokens: string[], budget: number) {
  if (!tokens.length || text.length <= budget) return text.slice(0, budget);
  const lowered = text.toLowerCase();
  const indexes = tokens
    .map((token) => lowered.indexOf(token))
    .filter((index) => index >= 0);
  if (!indexes.length) return text.slice(0, budget);

  const center = Math.min(...indexes);
  const start = Math.max(0, center - Math.floor(budget * 0.35));
  return text.slice(start, start + budget);
}

function sectionScore(section: Section, focus: string, tokens: string[]) {
  if (!focus.trim()) return 0;
  const heading = normalize(section.heading);
  const body = normalize(section.text);
  const normalizedFocus = normalize(focus);
  let score = heading.includes(normalizedFocus) ? 50 : 0;

  const requestedBook = normalizedFocus.match(/\bbook\s+(i{1,3}|iv|v|vi{0,3}|ix|x|\d+)\b/);
  if (requestedBook && heading.includes(`book ${requestedBook[1]}`)) score += 100;

  for (const token of tokens) {
    if (heading.includes(token)) score += 12;
    const occurrences = body.split(token).length - 1;
    score += Math.min(occurrences, 8);
  }
  return score;
}

function sourceIdentity(source: PodcastContextSource) {
  if (source.metadata && typeof source.metadata === "object") {
    const metadata = source.metadata as Record<string, unknown>;
    const parent =
      metadata.derivedFromSourceId ||
      metadata.originalSourceId ||
      metadata.sourceId;
    if (typeof parent === "string" && parent.trim()) return parent;
  }
  return source.id || `${source.title || "source"}:${(source.content || "").slice(0, 120)}`;
}

export function buildPodcastSourceContext(
  sources: PodcastContextSource[],
  { focus = "", maxChars = 12_000 }: BuildPodcastContextOptions = {},
): string {
  const unique = new Map<string, PodcastContextSource>();
  for (const source of sources) {
    if (!source.content?.trim()) continue;
    const identity = sourceIdentity(source);
    if (!unique.has(identity)) unique.set(identity, source);
  }

  const prepared = [...unique.values()].map((source) => ({
    source,
    sections: splitMajorSections(source.content || ""),
  }));
  if (!prepared.length) return "";

  if (!Number.isSafeInteger(maxChars) || maxChars < 500 || maxChars > 100_000) {
    throw new Error('Podcast context budget must be an integer between 500 and 100000 characters.');
  }
  const tokens = focusTokens(focus);
  const sourceBudget = Math.floor((maxChars - (prepared.length - 1) * 2) / prepared.length);
  if (sourceBudget < 300) throw new Error('Too many sources for a useful podcast excerpt. Select fewer sources or a narrower focus.');

  const sample = (text: string, budget: number): string => {
    if (text.length <= budget) return text;
    const omitted = '\n[... excerpt gap ...]\n';
    const size = Math.floor((budget - omitted.length * 2) / 3);
    if (size < 10) return '[Excerpt unavailable: select a narrower focus.]'.slice(0, budget);
    const middle = Math.floor((text.length - size) / 2);
    return text.slice(0, size) + omitted + text.slice(middle, middle + size) + omitted + text.slice(-size);
  };
  const evenly = (sections: Section[], count: number): Section[] => {
    if (sections.length <= count) return sections;
    if (count === 1) return [sections[0]];
    return Array.from({ length: count }, (_, i) => sections[Math.round(i * (sections.length - 1) / (count - 1))]);
  };
  const outputs = prepared.map(({ source, sections }) => {
    const title = (source.title?.trim() || 'Source').slice(0, Math.min(200, sourceBudget / 5));
    const outline = sections.map(section => section.heading).join(' · ').slice(0, Math.min(500, sourceBudget / 5));
    const header = `SOURCE: ${title}\nSTRUCTURE: ${outline}\nCOVERAGE: selected evidence excerpts; not a certificate of full-document coverage.\n`;
    const bodyBudget = sourceBudget - header.length;
    const maximumSections = Math.max(1, Math.floor(bodyBudget / 160));
    const ranked = tokens.length ? sections.map(section => ({ section, score: sectionScore(section, focus, tokens) })).sort((a,b) => b.score-a.score) : [];
    const relevant = ranked.filter(item => item.score > 0);
    const chosen = tokens.length
      ? (relevant.length ? relevant : ranked).slice(0, Math.min(4, maximumSections)).map(item => item.section)
      : evenly(sections, maximumSections);
    const perSection = Math.floor((bodyBudget - Math.max(0, chosen.length - 1) * 2) / Math.max(1, chosen.length));
    const body = chosen.map(section => {
      const label = `[${section.heading.slice(0, 65)}]\n`;
      const budget = Math.max(0, perSection - label.length);
      if (tokens.length && section.text.length > budget) {
        const note = '\n[focused excerpt; other text omitted]';
        return label + relevantWindow(section.text, tokens, Math.max(0,budget-note.length)) + note;
      }
      return label + sample(section.text, budget);
    }).join('\n\n');
    return header + body;
  });
  const result = outputs.join('\n\n');
  if (result.length > maxChars) throw new Error('Podcast source selection exceeded its context budget. Select fewer sources.');
  return result;
}
