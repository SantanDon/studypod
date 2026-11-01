import type { EvidencePassage } from './podcastEvidencePlan';

export interface DiscussionEvidence { passageId: string; quote: string }
export interface DiscussionTurn {
  speaker: 'host1' | 'host2';
  kind: 'explanation' | 'inference' | 'question';
  text: string;
  evidence: DiscussionEvidence[];
}
export interface DiscussionSection { title: string; turns: DiscussionTurn[] }

/** Only enum drift permits a bounded regeneration; evidence failures never do. */
export class DiscussionKindError extends Error {}

const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
// Quote typography is interchangeable; words, negations, dashes, and omissions are not.
// These substitutions preserve string length so accepted spans retain source spelling.
const normalizeQuoteTypography = (value: string) => value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function parseJson(response: string): unknown {
  const text = response.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* Some local models wrap a complete object in prose. */ }
  const start = text.indexOf('{');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  if (start >= 0 && !/[[\]{}]/.test(text.slice(0, start))) {
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        // Extract only one already complete object. Never close or repair truncated output.
        if (!/[[\]{}]/.test(text.slice(index + 1))) {
          try { return JSON.parse(text.slice(start, index + 1)); } catch { break; }
        }
        break;
      }
    }
  }
  throw new Error('Deep discussion returned invalid JSON. No audio was produced.');
}

/** Quotes prove provenance, not entailment. A separate semantic verifier is mandatory. */
export function parseDiscussionSection(response: string, passages: EvidencePassage[], solo: boolean): DiscussionSection {
  // Formatting and repeated quote metadata are not spoken content. Bound transport
  // separately, then measure the exact canonical payload sent to the verifier.
  if (response.length > 24_000) throw new Error('Deep discussion exceeds the bounded verification budget. No audio was produced.');
  const value = parseJson(response);
  // Some structured-output providers omit the decorative title. A fixed label
  // needs no model repair; the complete attributed turns still pass every check.
  if (!record(value) || !(exactKeys(value, ['title', 'turns']) || exactKeys(value, ['turns'])) ||
      ('title' in value && (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120)) ||
      !Array.isArray(value.turns) || value.turns.length < 3 || value.turns.length > 10) {
    throw new Error('Deep discussion has an invalid section shape. No audio was produced.');
  }
  const byId = new Map(passages.map(passage => [passage.id, passage]));
  const seenText = new Set<string>();
  const turns: DiscussionTurn[] = value.turns.map((turn, turnIndex) => {
    if (!record(turn) || !exactKeys(turn, ['speaker', 'kind', 'text', 'evidence']) ||
        !['host1', 'host2'].includes(String(turn.speaker)) || (solo && turn.speaker !== 'host1') ||
        typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 4500 ||
        /\bSOURCE_ID\b|\bpassageId\b|\bevidenceSourceIds\b/i.test(turn.text) ||
        !Array.isArray(turn.evidence) || !turn.evidence.length || turn.evidence.length > 4) {
      throw new Error('Deep discussion contains an invalid or unattributed turn. No audio was produced.');
    }
    if (!['explanation', 'inference', 'question'].includes(String(turn.kind))) {
      throw new DiscussionKindError(`Deep discussion turn ${turnIndex + 1} has an invalid kind. Use only explanation, inference, or question. No audio was produced.`);
    }
    const normalizedText = normalize(turn.text);
    if (seenText.has(normalizedText)) throw new Error('Deep discussion repeats a turn. No audio was produced.');
    seenText.add(normalizedText);
    const seenSpans = new Set<string>();
    const evidence: DiscussionEvidence[] = turn.evidence.map(ref => {
      if (!record(ref) || !exactKeys(ref, ['passageId', 'quote']) || typeof ref.passageId !== 'string' ||
          typeof ref.quote !== 'string' || normalize(ref.quote).length < 12 || ref.quote.length > 1200 ||
          !byId.has(ref.passageId)) {
        throw new Error('Deep discussion cites an unknown passage or a quote absent from its source. No audio was produced.');
      }
      const source = normalize(byId.get(ref.passageId)!.text);
      const quote = normalizeQuoteTypography(normalize(ref.quote));
      const start = normalizeQuoteTypography(source).indexOf(quote);
      const spanKey = `${ref.passageId}\u0000${quote}`;
      if (start < 0 || seenSpans.has(spanKey)) {
        throw new Error('Deep discussion cites an unknown passage or a quote absent from its source. No audio was produced.');
      }
      seenSpans.add(spanKey);
      return {passageId: ref.passageId, quote: source.slice(start, start + quote.length)};
    });
    return {speaker: turn.speaker as DiscussionTurn['speaker'], kind: turn.kind as DiscussionTurn['kind'], text: turn.text.trim(), evidence};
  });
  if (turns.filter(turn => turn.kind === 'explanation').length < 2 || !turns.some(turn => turn.kind === 'question') ||
      (!solo && !turns.some(turn => turn.speaker === 'host2')) || turns.reduce((sum, turn) => sum + words(turn.text), 0) > 1100) {
    throw new Error('Deep discussion must explain evidence and include a grounded learning question within its word budget.');
  }
  // Leave at least 2k characters for verifier instructions within its 20k prompt
  // budget. Include full evidence, not only quoted spans, for entailment.
  if (JSON.stringify({passages, turns}).length > 18_000) {
    throw new Error('Deep discussion exceeds the bounded verification budget. No audio was produced.');
  }
  return {title: typeof value.title === 'string' ? value.title.trim() : 'Source-grounded discussion', turns};
}

export class IncompleteDiscussionVerdictError extends Error {
  constructor() {
    super('Deep discussion could not be verified. No audio was produced.');
  }
}

export class DiscussionSupportError extends Error {
  constructor(public readonly rejectedTurnIndexes: number[]) {
    super('Deep discussion includes unsupported or unverified claims. No audio was produced.');
  }
}

/** Validate the complete verdict before exposing semantic rejections for repair. */
export function verifyDiscussionSection(response: string, turnCount: number): void {
  const value = parseJson(response);
  if (!record(value) || !exactKeys(value, ['verdicts']) || !Array.isArray(value.verdicts) || value.verdicts.length > turnCount) {
    throw new Error('Deep discussion could not be verified. No audio was produced.');
  }
  const seen = new Set<number>();
  const rejected: number[] = [];
  for (const verdict of value.verdicts) {
    if (!record(verdict) || !exactKeys(verdict, ['turnIndex', 'supported']) ||
        !Number.isInteger(verdict.turnIndex) || Number(verdict.turnIndex) < 0 || Number(verdict.turnIndex) >= turnCount ||
        seen.has(Number(verdict.turnIndex)) || typeof verdict.supported !== 'boolean') {
      throw new Error('Deep discussion includes unsupported or unverified claims. No audio was produced.');
    }
    seen.add(Number(verdict.turnIndex));
    if (!verdict.supported) rejected.push(Number(verdict.turnIndex));
  }
  if (value.verdicts.length < turnCount) throw new IncompleteDiscussionVerdictError();
  if (rejected.length) throw new DiscussionSupportError(rejected);
}

/** Keep complete passages and source order; every request fits the local prompt budget. */
export function batchDiscussionEvidence(passages: EvidencePassage[]): EvidencePassage[][] {
  const batches: EvidencePassage[][] = [];
  let batch: EvidencePassage[] = [];
  let size = 0;
  for (const passage of passages) {
    const length = JSON.stringify(passage).length;
    if (length > 7600) throw new Error('A source passage exceeds the Deep discussion request budget. Select a shorter section.');
    if (batch.length && size + length > 7600) { batches.push(batch); batch = []; size = 0; }
    if (batches.length >= 4) break;
    batch.push(passage); size += length;
  }
  if (batch.length && batches.length < 4) batches.push(batch);
  if (!batches.length) throw new Error('No usable passages are available for a Deep discussion.');
  return batches;
}

export function compileDiscussionSections(sections: DiscussionSection[], passages: EvidencePassage[], host1: string, host2: string) {
  const segments: {speaker: string; text: string}[] = [];
  const segmentEvidence: {segmentIndex: number; kind: DiscussionTurn['kind']; evidence: DiscussionEvidence[]}[] = [];
  const ids = new Set<string>();
  const spoken = new Set<string>();
  for (const section of sections) for (const turn of section.turns) {
    const key = normalize(turn.text);
    if (spoken.has(key)) throw new Error('Deep discussion repeats content across sections. No audio was produced.');
    spoken.add(key);
    segmentEvidence.push({segmentIndex: segments.length, kind: turn.kind, evidence: turn.evidence});
    segments.push({speaker: turn.speaker === 'host1' ? host1 : host2, text: turn.text});
    turn.evidence.forEach(ref => ids.add(ref.passageId));
  }
  const used = passages.filter(passage => ids.has(passage.id));
  const count = segments.reduce((sum, segment) => sum + words(segment.text), 0);
  if (!segments.length || count > 4500) throw new Error('Deep discussion exceeds its episode budget. No audio was produced.');
  return {
    title: sections[0].title, segments, words: count,
    evidencePassageIds: used.map(passage => passage.id),
    evidenceSourceIds: [...new Set(used.map(passage => passage.sourceId).filter((id): id is string => !!id))],
    segmentEvidence,
    discussionSections: sections.map(section => section.title),
  };
}
