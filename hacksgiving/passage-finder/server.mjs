import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { matchPassage } from './match.mjs';

const repository = 'SantanDon/studypod';
const branch = 'codex/studypod-audiobook-breakthrough-july-2026';
const path = 'hacksgiving/passage-finder/guide.md';
class GuideError extends Error {}

function repositoryBase() {
  if (process.argv.includes('--public-preview')) return 'https://api.github.com/repos/' + repository;
  const connector = process.env.SPRITES_GITHUB_CONNECTOR;
  if (!connector || !/^[A-Za-z0-9_-]+$/.test(connector)) throw new GuideError('Missing connector ID');
  return 'https://api.sprites.dev/v1/gateway/github/' + connector + '/repos/' + repository;
}

const html = await readFile(new URL('./index.html', import.meta.url));
let cached;
let loading;

async function getJson(url) {
  const result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'StudyPod-Passage-Finder' } });
  if (!result.ok) throw new GuideError('Connector HTTP ' + result.status);
  return result.json();
}

async function loadGuide() {
  const base = repositoryBase();
  const [commit] = await getJson(base + '/commits?per_page=1&sha=' + encodeURIComponent(branch) + '&path=' + encodeURIComponent(path));
  if (!/^[a-f0-9]{40}$/.test(commit?.sha)) throw new GuideError('Missing revision');
  const file = await getJson(base + '/contents/' + path + '?ref=' + commit.sha);
  if (file?.encoding !== 'base64' || typeof file.content !== 'string' ||
      !Number.isInteger(file.size) || file.size < 1 || file.size > 65536) {
    throw new GuideError('Invalid guide');
  }
  const lines = Buffer.from(file.content, 'base64').toString('utf8').split(/\r?\n/);
  let heading = '';
  const passages = [];
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('#')) heading = line.replace(/^#+\s*/, '');
    else if (line.trim()) passages.push({ heading, quote: line, url: 'https://github.com/' + repository + '/blob/' + commit.sha + '/' + path + '?plain=1#L' + (i + 1) });
  }
  cached = { passages, expires: Date.now() + 60000 };
  return cached;
}

async function answer(question) {
  if (!cached || cached.expires < Date.now()) {
    loading ??= loadGuide().catch(error => {
      const reason = error instanceof GuideError ? error.message
        : error.name === 'TimeoutError' ? 'Connector timed out'
        : error instanceof SyntaxError ? 'Invalid connector JSON' : 'Connector request failed';
      console.warn('[Passage Finder] ' + reason);
      throw error;
    }).finally(() => { loading = undefined; });
    await loading;
  }
  return matchPassage(question, cached.passages);
}

export const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-tF2fbGiGtegs/JQ+cX4hL5szvDlRTm+wH+eN24y3OsY='; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400).end(); return; }
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
  if (url.pathname !== '/answer') { res.writeHead(404).end(); return; }
  const question = url.searchParams.get('q')?.trim();
  if (!question || question.length > 240) { res.writeHead(400).end(); return; }
  try {
    const passage = await answer(question);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ passage }));
  } catch { res.writeHead(503).end(); }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0');
}
