// Observational, Cedar-fixture-only telemetry. Never changes acceptance checks.
import { createHash } from 'node:crypto';
export const attachmentName = 'cedar-exact-three-flashcard-count-diagnostic';
export const fixtureSha256 = 'bc111638707355188f9cd9d94a2c21d0186ad9a7ab88bb6d43beea3d5260063f';
const prefix = '[StudyPod flashcard acceptance] ';
export const reasons = ['schema_validation','no_schema_valid_records','evidence_occurrence','evidence_length','source_instruction','empty_answer','answer_length','answer_word_count','trivial_answer','blank_marker','answer_absent','answer_occurrence','word_boundary','context_word_count','answer_context_ratio','duplicate_evidence'];
const keys = ['version','responseCharacters','responseBytes','responseSha256','requestedCount','selectedCards','parsedRecords','eligibleCards','rejections'];
const integer = (n, max = 10000) => Number.isInteger(n) && n >= 0 && n <= max;
const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === allowed.length && allowed.every(k => Object.hasOwn(value, k));
function validRow(row) {
  return exact(row, keys) && row.version === 1 && integer(row.responseCharacters, 2000000) && integer(row.responseBytes, 8000000)
    && (row.responseSha256 === null || (typeof row.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.responseSha256)))
    && Number.isInteger(row.requestedCount) && row.requestedCount >= 1 && row.requestedCount <= 3
    && integer(row.selectedCards, row.requestedCount) && integer(row.parsedRecords) && integer(row.eligibleCards)
    && exact(row.rejections, reasons) && reasons.every(reason => integer(row.rejections[reason]));
}
export function validateDiagnostic(value) {
  return exact(value, ['schemaVersion','fixtureSha256','requestedCount','enabled','observed','rejectedMessages','rows'])
    && value.schemaVersion === 1 && value.fixtureSha256 === fixtureSha256 && value.requestedCount === 3
    && typeof value.enabled === 'boolean' && typeof value.observed === 'boolean' && integer(value.rejectedMessages)
    && Array.isArray(value.rows) && value.rows.length <= 2 && value.observed === (value.rows.length > 0)
    && (value.enabled || value.rows.length === 0) && value.rows.every(validRow)
    && (!value.rows.length || value.rows[0].requestedCount === 3)
    && (value.rows.length < 2 || (value.rows[1].requestedCount === 3 - value.rows[0].selectedCards));
}
export function createCountDiagnostic({ enabled, fixture, requestedCount }) {
  if (requestedCount !== 3 || createHash('sha256').update(fixture).digest('hex') !== fixtureSha256) throw new Error('Diagnostic fixture guard mismatch');
  const state = { schemaVersion: 1, fixtureSha256, requestedCount: 3, enabled: enabled === true, observed: false, rejectedMessages: 0, rows: [] };
  let active = false;
  return {
    start() { active = true; }, stop() { active = false; },
    ingest(text) {
      if (!active || !state.enabled || typeof text !== 'string' || !text.startsWith(prefix)) return;
      let row;
      try { if (text.length > 8192) throw new Error(); row = JSON.parse(text.slice(prefix.length)); } catch { state.rejectedMessages = Math.min(10000, state.rejectedMessages + 1); return; }
      const trial = { ...state, observed: true, rows: [...state.rows, row] };
      if (!validateDiagnostic(trial)) { state.rejectedMessages = Math.min(10000, state.rejectedMessages + 1); return; }
      // Validation rejects extra keys; copying retains only the fixed numeric/hash schema.
      state.rows.push(JSON.parse(JSON.stringify(row))); state.observed = true;
    },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
  };
}
