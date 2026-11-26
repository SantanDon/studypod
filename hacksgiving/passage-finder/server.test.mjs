import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { test } from 'node:test';
import { server } from './server.mjs';

test('HTTP answers cite the exact revision and line returned by the connector', async t => {
  process.env.SPRITES_GITHUB_CONNECTOR = 'test-connector';
  const request = globalThis.fetch;
  const sha = 'a'.repeat(40);
  const guide = await readFile(new URL('./guide.md', import.meta.url), 'utf8');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url);
    assert.equal(path.origin, 'https://api.sprites.dev');
    assert.ok(path.pathname.startsWith('/v1/gateway/github/test-connector/repos/SantanDon/studypod/'));
    calls.push(path);
    return Response.json(path.pathname.includes('/commits')
      ? [{ sha }]
      : { encoding: 'base64', size: Buffer.byteLength(guide), content: Buffer.from(guide).toString('base64') });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await request(base);
  const html = (await home.text()).replace(/\r\n/g, '\n');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const digest = createHash('sha256').update(scripts[0][1]).digest('base64');
  assert.ok(home.headers.get('content-security-policy').split(';').map(value => value.trim()).includes(`script-src 'sha256-${digest}'`));
  const response = await request(base + '/answer?q=Friday');
  assert.equal(response.status, 200);
  const { passage } = await response.json();
  const citation = new URL(passage.url);
  assert.equal(citation.origin, 'https://github.com');
  assert.equal(citation.pathname, '/SantanDon/studypod/blob/' + sha + '/hacksgiving/passage-finder/guide.md');
  assert.match(citation.hash, /^#L\d+$/);
  assert.equal(passage.quote, guide.split(/\r?\n/)[Number(citation.hash.slice(2)) - 1]);
  assert.equal(passage.heading, 'Friday');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('ref'), sha);
  const unrelated = await request(base + '/answer?q=weather+on+Friday');
  assert.deepEqual(await unrelated.json(), { passage: null });
  assert.equal((await request(base + '/answer?q=')).status, 400);
  assert.equal((await request(base + '/answer', { method: 'POST' })).status, 405);
});
