import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { evaluate } from './youtube-question-oracle.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const QUESTION = 'bd491b7fa638e34c28c1bd1267f7695d288fce1d8eb6db89819547dcfd27b084';
const SOURCE = '4c28c9ce4c3465ecd3c5d68e1be2af558038d42f609f69d235eea2f7bcf61d9d';
const REFERENCE = 'ddc7ba886963477866a6798d872201dc1fb9a23e0ad8dc5ed78d0d82c90b07c5';
export function assertFreshConversation(messages) {
  if (!Array.isArray(messages) || messages.length !== 0) throw new Error('youtube-conversation-not-fresh');
}
export function selectNewAssistant(before, after, question) {
  assertFreshConversation(before);
  if (!Array.isArray(after) || after.length !== 2 || after[0]?.role !== 'user'
      || after[0]?.content !== question || after[1]?.role !== 'assistant'
      || typeof after[1]?.content !== 'string' || !after[1].content.trim()) throw new Error('youtube-new-turn-ambiguous');
  return after[1];
}
export function mapOwnedCitations(answer, citations, sourceId) {
  if (!Array.isArray(citations) || citations.length === 0) throw new Error('youtube-citations-missing');
  return citations.map(c => {
    if (c.source_id !== sourceId || !Number.isSafeInteger(c.citation_id) || c.citation_id < 1
        || !new RegExp(`\\[${c.citation_id}\\]`).test(answer)
        || typeof (c.prefetched_content || c.excerpt) !== 'string') throw new Error('youtube-citation-mapping-failed');
    return { sourceIndex: 1, excerpt: (c.prefetched_content || c.excerpt).trim() };
  });
}
export function checkPins(question, source, referenceBytes) {
  if (sha256(question) !== QUESTION || sha256(source) !== SOURCE || sha256(referenceBytes) !== REFERENCE)
    throw new Error('youtube-reference-drift');
}
export function checkYouTube({ question, source, answer, citations, project, publicRoot }) {
  const referencePath = process.env.STUDYPOD_YOUTUBE_REFERENCE;
  const privateDir = process.env.STUDYPOD_YOUTUBE_PRIVATE_RECEIPTS;
  if (!referencePath || !privateDir) throw new Error('youtube-private-inputs-required');
  const directory = fs.realpathSync(privateDir), publicDirectory = fs.realpathSync(publicRoot);
  const relative = path.relative(publicDirectory, directory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
    throw new Error('youtube-private-receipts-inside-public-artifacts');
  const referenceBytes = fs.readFileSync(referencePath);
  checkPins(question, source.content, referenceBytes);
  let reference;
  try { reference = JSON.parse(referenceBytes); } catch { throw new Error('youtube-reference-schema'); }
  if (sha256(reference.source) !== SOURCE || sha256(reference.question) !== QUESTION) throw new Error('youtube-reference-schema');
  let mapped = [], failure;
  try { mapped = mapOwnedCitations(answer.content, citations, source.id); } catch (error) { failure = error.message; }
  const response = { answer: answer.content, citations: mapped };
  const privateBytes = JSON.stringify({ version: 1, questionSHA256: QUESTION, sourceSHA256: SOURCE,
    messageSHA256: sha256(answer.content), project, response, rawCitations: citations });
  const privateFile = path.join(directory, `youtube-${randomUUID()}.private.json`);
  fs.writeFileSync(privateFile, privateBytes, { flag: 'wx', mode: 0o600 });
  const result = failure ? { accept: false, reasons: [failure], additionalClaimReviewRequired: true, releaseAuthorized: false }
    : evaluate(response, reference);
  return { version: 1, caseId: 'youtube-question-v1', questionSHA256: QUESTION, sourceSHA256: SOURCE,
    messageSHA256: sha256(answer.content), citationSHA256: sha256(JSON.stringify(mapped)), privateReceiptSHA256: sha256(privateBytes),
    referenceSHA256: REFERENCE, ...result };
}

// Keep raw transcript, generated cards and assertion diffs out of shared JSON.
export function publicYouTubeReceipt(receipt) {
 const sensitive=new Set(['excerpt','extractedExcerpt','front','back','metadata','error','failure','pageErrors']);
 const visit=value=>Array.isArray(value)?value.map(visit):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='pageErrors'&&Array.isArray(item)?item.map(error=>sha256(JSON.stringify(error))):sensitive.has(key)
   ?{sha256:sha256(JSON.stringify(item)),count:Array.isArray(item)?item.length:undefined}:visit(item)])):value;
 return visit(receipt);
}
