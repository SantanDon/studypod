import { createSharedAudioPolicy } from './shared-account-audio-policy.mjs';
export function createSharedAudiobookPolicy(origin) {
 const base = createSharedAudioPolicy(origin); const files = new Set(); const jobs = new Set();
 return { ...base, registerFile(file) { if (base.ids().length !== 1 || typeof file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(file)) throw new Error('Invalid run-owned audiobook file'); files.add(file); }, registerJob(job) { if (typeof job !== 'string' || !/^[A-Za-z0-9_-]+$/.test(job)) throw new Error('Invalid run-owned audiobook job'); jobs.add(job); }, files() { return [...files]; }, decide(rawUrl, method, body) {
 const original = base.decide(rawUrl, method); const url = new URL(rawUrl); const verb = method.toUpperCase();
 if (url.origin !== origin || url.username || url.password || base.ids().length !== 1) return original;
 if (url.pathname === '/api/audiobook/extract' && verb === 'POST') return { allowed: true, captureExtract: true };
 if (url.pathname === '/api/audiobook/generate-full' && verb === 'POST' && body && files.has(body.fileName)) return { allowed: true, captureJob: true };
 const uploadedBook = url.pathname.match(/^\/api\/audiobook\/books\/([^/]+)$/);
 if (uploadedBook && verb === 'DELETE' && !url.search && files.has(decodeURIComponent(uploadedBook[1]))) return { allowed: true };
 const book = url.pathname.match(/^\/api\/audiobook\/books\/([^/]+)\/(progress|bookmarks(?:\/[^/]+)?|audio)$/);
 if (book && files.has(decodeURIComponent(book[1])) && ((verb === 'POST' && /^(progress|bookmarks)$/.test(book[2])) || (verb === 'DELETE' && /^(audio|bookmarks\/[^/]+)$/.test(book[2])))) return { allowed: true };
 const job = url.pathname.match(/^\/api\/audiobook\/jobs\/([^/]+)\/cancel$/);
 if (job && jobs.has(decodeURIComponent(job[1])) && verb === 'POST') return { allowed: true };
 return original;
 } };
}

export function verifyAudiobookCleanup({ fileName, registeredFiles, bookDeleteStatus, bookDeleteBody, bookMetadataStatus, notebookDeleteStatus, notebookReadStatus }) {
 const book = !fileName ? 'not-created' : !registeredFiles.includes(fileName) ? 'blocked-unowned-file' : bookDeleteStatus === 200 && bookDeleteBody?.deleted === true && bookDeleteBody?.fileName === fileName && bookMetadataStatus === 404 ? 'verified-deleted' : 'incomplete-book-upload-retained';
 const notebook = notebookDeleteStatus === 200 && notebookReadStatus === 404 ? 'verified-deleted' : 'cleanup-failed';
 return { book, notebook, cleanup: notebook === 'verified-deleted' && (book === 'verified-deleted' || book === 'not-created') ? 'verified-deleted' : book === 'incomplete-book-upload-retained' ? book : 'cleanup-failed' };
}
