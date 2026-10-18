import { createHash } from 'node:crypto';
import { content } from './full-flow-fixtures.mjs';

export const ratioDiagnosticPrefix = '[StudyPod flashcard ratio acceptance] ';
const expectedFixtureSha256 = 'bc111638707355188f9cd9d94a2c21d0186ad9a7ab88bb6d43beea3d5260063f';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const words = (value: string) => (value.match(/[\p{L}\p{N}]+/gu) || []).length;
const normalizedFixture = content.replace(/\s+/g, ' ').trim();
// Only public, synthetic whole-word spans are allowed to reach persisted receipts.
const fixtureSentences = hash(normalizedFixture) === expectedFixtureSha256 ? normalizedFixture.split(/(?<=[.!?])\s+/) : [];
const allowed = fixtureSentences.map((sentence: string) => {
  const spans = new Map<string, { answerWords: number; contextWords: number }>();
  const tokens = Array.from(sentence.matchAll(/[\p{L}\p{N}]+/gu));
  for (let first = 0; first < tokens.length; first++) for (let last = first; last < tokens.length; last++) {
    const start = tokens[first].index!;
    const end = tokens[last].index! + tokens[last][0].length;
    const answer = sentence.slice(start, end);
    const answerWords = words(answer);
    const contextWords = words(sentence.slice(0, start) + sentence.slice(end));
    if (answer.length <= 200 && answerWords <= 12 && contextWords >= 3 && answerWords >= contextWords)
      spans.set(hash(answer), { answerWords, contextWords });
  }
  return { sha256: hash(sentence), wordCount: words(sentence), spans };
});

export interface SafeRatioObservation {
  ordinal: number; reason: 'answer_context_ratio'; evidenceSha256: string; answerSha256: string;
  evidenceWordCount: number; answerWordCount: number; remainingContextWordCount: number;
  syntheticFixtureSentenceOrdinal: number; alreadyApprovedEvidence: boolean;
}
export interface SafeRatioDiagnostic { version: 1; syntheticFixtureSha256: string; observations: SafeRatioObservation[]; }
export const ratioDiagnosticsEnabled = () => process.env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1'
  && process.env.VITE_STUDYPOD_ACCEPTANCE_RATIO_DIAGNOSTICS === 'true';
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const rowKeys = ['ordinal', 'reason', 'evidenceSha256', 'answerSha256', 'evidenceWordCount', 'answerWordCount', 'remainingContextWordCount', 'syntheticFixtureSentenceOrdinal', 'alreadyApprovedEvidence'];
export function parseRatioDiagnostic(type: string, text: string): SafeRatioDiagnostic | null {
  if (!ratioDiagnosticsEnabled() || type !== 'info' || !text.startsWith(ratioDiagnosticPrefix) || text.length > 25000) return null;
  try {
    const value: unknown = JSON.parse(text.slice(ratioDiagnosticPrefix.length));
    if (!exactKeys(value, ['version', 'syntheticFixtureSha256', 'observations']) || value.version !== 1
      || value.syntheticFixtureSha256 !== expectedFixtureSha256 || !Array.isArray(value.observations)
      || value.observations.length < 1 || value.observations.length > 50) return null;
    const observations: SafeRatioObservation[] = [];
    for (const [index, row] of value.observations.entries()) {
      if (!exactKeys(row, rowKeys) || row.ordinal !== index + 1 || row.reason !== 'answer_context_ratio'
        || !Number.isSafeInteger(row.syntheticFixtureSentenceOrdinal) || typeof row.answerSha256 !== 'string'
        || typeof row.alreadyApprovedEvidence !== 'boolean') return null;
      const sentence = allowed[Number(row.syntheticFixtureSentenceOrdinal) - 1];
      const span = sentence?.spans.get(row.answerSha256);
      if (!sentence || !span || row.evidenceSha256 !== sentence.sha256 || row.evidenceWordCount !== sentence.wordCount
        || row.answerWordCount !== span.answerWords || row.remainingContextWordCount !== span.contextWords) return null;
      // Copy fixed fields rather than preserving untrusted objects/prototypes.
      observations.push({ ordinal: index + 1, reason: 'answer_context_ratio', evidenceSha256: sentence.sha256,
        answerSha256: row.answerSha256, evidenceWordCount: sentence.wordCount, answerWordCount: span.answerWords,
        remainingContextWordCount: span.contextWords, syntheticFixtureSentenceOrdinal: Number(row.syntheticFixtureSentenceOrdinal),
        alreadyApprovedEvidence: row.alreadyApprovedEvidence });
    }
    return { version: 1, syntheticFixtureSha256: expectedFixtureSha256, observations };
  } catch { return null; }
}
