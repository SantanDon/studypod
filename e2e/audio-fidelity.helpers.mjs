import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.syntheticReference !== true) throw new Error('Only explicitly synthetic reference material is permitted in these receipts.');
  if (!['podcast', 'audiobook'].includes(manifest.kind)) throw new Error('Require podcast or audiobook kind.');
  if (!Array.isArray(manifest.facts) || !manifest.facts.length) throw new Error('Require predeclared source fact assertions.');
  const file = key => readFileSync(resolve(dirname(path), manifest[key]));
  const audio = file('audioPath');
  if (sha256(audio) !== manifest.audioSha256) throw new Error('Generated download hash does not match manifest.');
  const wav = audio.subarray(0, 4).toString() === 'RIFF' && audio.subarray(8, 12).toString() === 'WAVE';
  const mp3 = audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224);
  const m4a = audio.subarray(4, 8).toString() === 'ftyp';
  const format = wav ? ['wav', 'audio/wav'] : mp3 ? ['mp3', 'audio/mpeg'] : m4a ? ['m4a', 'audio/mp4'] : null;
  if (!format) throw new Error('Unrecognized download container; do not relabel binary bytes as supported audio.');
  const source = file('sourcePath').toString('utf8');
  const script = file('scriptPath').toString('utf8');
  if (manifest.sourceSha256 && sha256(source) !== manifest.sourceSha256) throw new Error('Original source hash mismatch.');
  if (manifest.scriptSha256 && sha256(script) !== manifest.scriptSha256) throw new Error('Generated spoken script hash mismatch.');
  if (!source.trim() || !script.trim()) throw new Error('Require complete source and exact generated spoken script.');
  for (const fact of manifest.facts) {
    if (!fact.id || typeof fact.pattern !== 'string' || !fact.pattern.trim() || !new RegExp(fact.pattern, 'i').test(source)) throw new Error('Declared fact missing from original source.');
    if (new RegExp(fact.pattern, 'i').test('')) throw new Error('Fact patterns must not match empty text.');
    for (const pattern of fact.forbiddenPatterns || []) new RegExp(pattern, 'i');
  }
  if (new Set(manifest.facts.map(fact => fact.id)).size !== manifest.facts.length) throw new Error('Fact identifiers must be unique.');
  return { manifest, audio, source, script, format };
}

export function compareFacts(facts, source, script, transcript) {
  return facts.map(fact => ({ id: fact.id, source: new RegExp(fact.pattern, 'i').test(source),
    script: new RegExp(fact.pattern, 'i').test(script), speechTranscript: new RegExp(fact.pattern, 'i').test(transcript),
    scriptContradicted: (fact.forbiddenPatterns || []).some(pattern => new RegExp(pattern, 'i').test(script)),
    contradicted: (fact.forbiddenPatterns || []).some(pattern => new RegExp(pattern, 'i').test(transcript)) }));
}

// A diagnostic only: ASR spelling and punctuation differences cannot establish
// a TTS defect. Critical semantic facts remain the controlling assertion.
export function wordErrorRate(reference, actual) {
  const words = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const a = words(reference), b = words(actual);
  let row = b.map((_, i) => i + 1); row.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return { referenceWords: a.length, transcriptWords: b.length, edits: row[b.length], rate: a.length ? row[b.length] / a.length : null };
}

// A deliberately bounded oracle for this synthetic fixture, not a general
// entailment judge. Unrecognized propositions require review, even when all
// five presence checks pass. Whole-clause matching prevents a correct setup
// fact from laundering an appended invented outcome.
export const cedarAudioSourceSha256 = 'bc111638707355188f9cd9d94a2c21d0186ad9a7ab88bb6d43beea3d5260063f';
const cedarAudioPropositions = [
  ['synthetic', /^(?:synthetic studypod acceptance material|no private or copyrighted course material is included)$/],
  ['setup-trays', /^(?:the cedar experiment|this study|the experiment) uses (?:exactly )?17 blue trays$/],
  ['setup-seedlings', /^(?:each tray (?:contains|has) 3 bean seedlings|there are 3 bean seedlings in each tray)$/],
  ['setup-light', /^(?:the (?:bean )?seedlings|these plants|each tray) (?:receive|receives|get|gets) (?:light for )?6 hours(?: of light)? (?:daily|each day|per day)$/],
  ['setup-water', /^water is measured every morning$/],
  ['chlorophyll', /^chlorophyll absorbs light(?: during photosynthesis)?$/],
  ['photosynthesis', /^plants use carbon dioxide and water to produce sugars and release oxygen$/],
  ['photosynthesis', /^during photosynthesis plants use carbon dioxide and water to produce sugars and release oxygen$/],
  ['photosynthesis', /^photosynthesis (?:uses light energy to convert|converts) carbon dioxide and water into sugars (?:and releases|releasing) oxygen$/],
  ['photosynthesis', /^light (?:provides|supplies) (?:the )?energy for photosynthesis$/],
  ['photosynthesis', /^oxygen is released during photosynthesis$/],
  ['control', /^(?:the experimental control|the control(?: group)?) receives (?:the )?(?:same|identical) water but (?:absolutely )?no light$/],
  ['comparison', /^researchers compare growth after (?:14 days|2 weeks)$/],
  ['comparison', /^growth (?:is|will be) compared after (?:14 days|2 weeks)$/],
  ['no-results', /^(?:the source|this source|the supplied source) (?:describes|provides) (?:the )?(?:experimental )?setup (?:but|and) (?:does not (?:report|provide)|reports no) (?:observed )?results$/],
  ['no-results', /^(?:the source|this source|the supplied source) does not (?:report|provide) (?:observed )?(?:results|growth measurements|oxygen measurements)$/],
  ['scaffolding', /^(?:welcome to synthetic studypod|today we (?:analyze|discuss|examine) the cedar experiment|let us (?:review|discuss) the experimental setup|that is the experimental setup)$/],
  ['question', /^(?:what is the experimental setup|how does this setup compare to the experimental control|what do researchers compare after 14 days|what role does chlorophyll play in photosynthesis)$/],
];
export function auditCedarAudioGrounding(source, text) {
  const sourceSha256 = sha256(source);
  const failures = [];
  if (sourceSha256 !== cedarAudioSourceSha256) failures.push({ reason: 'unreviewed-source-fixture' });
  const clauses = String(text).split(/[.!?;]+(?:\s+|$)|[\r\n]+/u).map(value => value.trim()).filter(Boolean);
  if (!clauses.length) failures.push({ reason: 'empty-text' });
  const matched = [];
  for (const [index, raw] of clauses.entries()) {
    // Only harmless presentation normalization. Do not strip negation,
    // qualification, periods in numbers, or unknown content.
    const clause = raw.toLowerCase().replace(/[\u2019']/gu, "'").replace(/[,]/gu, '').replace(/\s+/gu, ' ').trim()
      .replace(/\bseventeen\b/gu, '17').replace(/\bthree\b/gu, '3').replace(/\bsix\b/gu, '6')
      .replace(/\bfourteen\b/gu, '14').replace(/\btwo\b/gu, '2');
    const proposition = cedarAudioPropositions.find(([, pattern]) => pattern.test(clause));
    if (proposition) matched.push(proposition[0]);
    else failures.push({ clause: index + 1, reason: 'unsupported-or-unreviewed-proposition' });
  }
  // Receipts intentionally expose no arbitrary generated/user text.
  return { scope: 'cedar-audio-supported-propositions-v1', sourceSha256, passed: failures.length === 0,
    clauseCount: clauses.length, matchedPropositions: [...new Set(matched)], failures };
}
