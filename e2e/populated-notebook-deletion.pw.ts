import { createCountDiagnostic, attachmentName } from './helpers/flashcard-count-diagnostics.mjs';
import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { authenticate, createNotebook, freshLifecycleContext, identity, requireIsolatedLocal } from './helpers/accountLifecycle';
import { podcastGenerationBudget } from './audio-generation-budget';
import { content } from './full-flow-fixtures.mjs';
import { auditProseCard } from './source-prose-oracle.mjs';

import { openRuntimeAudit, assertPopulated, assertPurged, assertRetained } from './helpers/notebook-row-audit.mjs';
import { resolve } from 'node:path';

const fact = /(?:17|seventeen) blue trays/i;
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function tab(page: Page, name: string) {
  expect(page.viewportSize()).toBeTruthy();
  if (page.viewportSize()!.width >= 1100) return;
  const control = page.getByRole('tab', { name: new RegExp(`(?:^|\\s)${name}$`) });
  await expect(control).toBeVisible(); await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}
async function rename(page: Page, oldTitle: string, title: string, id: string) {
  await page.locator('header').getByText(oldTitle, { exact: true }).click();
  const editor = page.locator('header').getByRole('textbox');
  await expect(editor).toBeFocused(); await editor.fill(title);
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/notebooks/${id}`);
  await editor.press('Enter'); expect((await saved).status()).toBe(200);
  await expect(page.locator('header').getByText(title, { exact: true })).toBeVisible();
}

test('populated-notebook-deletion: source citation deck and saved podcast remain deleted after fresh login', async ({ browser, page, baseURL }, info) => {
  test.setTimeout(900_000); // One real chat, one deck, one brief podcast; no retries.
  requireIsolatedLocal(baseURL);
  const countDiagnostic = createCountDiagnostic({ enabled: process.env.STUDYPOD_ACCEPTANCE_DIAGNOSTICS === '1', fixture: content, requestedCount: 3 });
  const diagnosticConsole = (message: { text(): string }) => countDiagnostic.ingest(message.text());
  page.on('console', diagnosticConsole);
  const contexts: BrowserContext[] = [];
  const rowAudit = openRuntimeAudit(resolve(process.cwd()));
  let physicalRowAndBlobPurgeVerified = false, populatedSiblingRetained = false;
  const owner = identity();
  const checks: string[] = [];
  let phase = 'owner-signup';
  const fresh = async () => {
    const context = await freshLifecycleContext(browser, baseURL, info); contexts.push(context);
    return { context, page: await context.newPage() };
  };
  try {
    await authenticate(page, owner, true);
    const target = await createNotebook(page);
    const title = `Populated deletion ${randomUUID()}`;
    await rename(page, target.title, title, target.id);
    const root = `/api/notebooks/${target.id}`;
    const read = async (context: BrowserContext, path: string) => {
      const response = await context.request.get(path); expect(response.status()).toBe(200); return response.json();
    };
    phase = 'actual-source-intake'; await tab(page, 'Sources');
    await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
    await page.getByRole('button', { name: /Pasted Content/ }).click();
    const sourceTitle = `Cedar deletion ${randomUUID()}`;
    await page.getByLabel('Title', { exact: true }).fill(sourceTitle);
    await page.getByLabel('Content', { exact: true }).fill(content);
    await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
    let source: { id: string; title: string; content: string; processingStatus: string };
    await expect.poll(async () => {
      const data = await read(page.context(), `${root}/sources`);
      source = (data.sources || data).find((item: { title: string }) => item.title === sourceTitle);
      return Boolean(source && ['completed', 'degraded'].includes(source.processingStatus) && normalize(source.content).includes(normalize(content)));
    }, { timeout: 120_000 }).toBe(true);
    checks.push('actual-readable-source');

    phase = 'grounded-chat-citation'; await tab(page, 'Chat');
    const input = page.getByPlaceholder(/Start typing|Ask only/); await expect(input).toBeEnabled();
    await input.fill('How many blue trays does the Cedar experiment use?');
    const answerResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `${root}/chat`, { timeout: 65_000 });
    await input.press('Enter'); expect((await answerResponse).status()).toBe(200);
    let answer: { role: string; content: string; groundedSources?: unknown; grounded_sources?: unknown };
    await expect.poll(async () => {
      const data = await read(page.context(), `${root}/messages`);
      answer = (data.messages || data).find((item: { role: string; content: string }) => item.role === 'assistant' && fact.test(item.content));
      return Boolean(answer);
    }, { timeout: 65_000 }).toBe(true);
    const raw = answer!.groundedSources ?? answer!.grounded_sources;
    const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { version: number; citations: { citation_id: number; source_id: string; excerpt: string; prefetched_content?: string }[] };
    expect(envelope.version).toBe(1); expect(Array.isArray(envelope.citations)).toBe(true);
    const citation = envelope.citations.find(item => Number(item.citation_id) === 1)!;
    expect(citation).toBeTruthy(); expect(citation.source_id).toBe(source!.id);
    const excerpt = (citation.prefetched_content || citation.excerpt).trim();
    expect(excerpt).toMatch(fact); expect(normalize(source!.content)).toContain(normalize(excerpt));
    const button = page.getByRole('button', { name: /^Citation 1/ }).first();
    await expect(button).toBeVisible(); await button.focus(); await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const evidenceId = await button.getAttribute('aria-controls'); expect(evidenceId).toBeTruthy();
    await expect(page.locator(`[id="${evidenceId}"]`)).toContainText(excerpt);
    await button.press('Enter'); checks.push('actual-answer-and-source-backed-visible-citation');

    phase = 'real-deck-generation'; await tab(page, 'Studio');
    const flashcards = page.getByRole('button', { name: /^Flashcards/ }).first();
    if (await flashcards.getAttribute('aria-expanded') !== 'true') await flashcards.click();
    const deckName = `Deletion deck ${randomUUID()}`;
    await page.getByRole('button', { name: /(?:^|\s)New Deck$/ }).click();
    await page.getByPlaceholder('Deck name...').fill(deckName);
    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `${root}/studio/decks`);
    await page.getByRole('button', { name: /(?:^|\s)Create Deck$/ }).click(); expect((await created).status()).toBe(201);
    await expect(page.getByText(deckName, { exact: true })).toBeVisible();
    const deckRead = async (context: BrowserContext) => (await read(context, `${root}/studio/decks`)).decks.find((item: { name: string }) => item.name === deckName);
    await page.getByRole('button', { name: /(?:^|\s)Generate$/ }).click();
    const dialog = page.getByRole('dialog'), combos = dialog.getByRole('combobox');
    await combos.nth(0).click(); await page.getByRole('option', { name: deckName, exact: true }).click();
    await combos.nth(1).click(); await page.getByRole('option', { name: sourceTitle, exact: true }).click();
    await combos.nth(2).click(); await page.getByRole('option', { name: '3 cards', exact: true }).click();
    countDiagnostic.start();
    await dialog.getByRole('button', { name: /(?:^|\s)Generate Cards$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 65_000 });
    countDiagnostic.stop();
    const deck = await deckRead(page.context()); expect(deck).toBeTruthy();
    for (const card of deck.cards) {
      expect(card.sourceId).toBe(source!.id);
      expect(auditProseCard({ card, source: source!, profile: 'cedar', authorizedSourceIds: [source!.id] }).outcome).toBe('independently-supported');
    }
    expect(deck.cards).toHaveLength(3);
    await expect(page.getByRole('button', { name: /(?:^|\s)Review 3 Cards$/ })).toBeVisible();
    checks.push('real-three-card-grounded-saved-deck');

    phase = 'real-podcast-generation-and-save';
    await page.getByTestId('btn-generate-podcast').click();
    await page.getByLabel(/Episode Focus/).fill('Explain the Cedar experiment retaining exactly 17 blue trays, three bean seedlings per tray, six hours daily, fourteen days, and the control receiving the same water but no light.');
    await page.getByRole('tab', { name: 'Brief', exact: true }).click();
    const generated = page.waitForResponse(r => {
      if (r.request().method() !== 'POST' || new URL(r.url()).pathname !== '/api/ai/generate') return false;
      return Boolean(r.request().postDataJSON()?.messages?.some((message: { role: string; content: string }) => message.role === 'system' && message.content.includes('educational podcast script writer')));
    }, { timeout: 150_000 });
    await page.getByTestId('btn-start-production').click();
    const response = await generated; expect(response.ok()).toBe(true);
    const generatedAnswer = (await response.json()).answer as string;
    const script = JSON.parse(generatedAnswer.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || generatedAnswer);
    expect(Array.isArray(script.segments)).toBe(true); expect(script.segments.length).toBeGreaterThan(0);
    for (const segment of script.segments) { expect(typeof segment.speaker).toBe('string'); expect(segment.text.trim().length).toBeGreaterThan(0); }
    const player = page.locator('.podcast-player-container');
    const saveFailure = page.getByRole('alert').filter({ hasText: 'Episode needs saving' });
    await expect(player.or(saveFailure).first()).toBeVisible({ timeout: podcastGenerationBudget(script.segments.length).timeoutMs });
    await expect(saveFailure).toHaveCount(0); await expect(player).toBeVisible();
    await expect(player.locator('.podcast-validation-ok .validation-text')).toHaveText(/^Audio signal detected \(\d+s, [\d.]+kHz\)$/);
    await expect(player.locator('.podcast-validation-warning')).toHaveCount(0);
    let podcast: { id: string; notebook_id: string; persistence: string; source_ids: string[]; audio_sha256: string; byte_length: number };
    await expect.poll(async () => {
      const data = await read(page.context(), `${root}/studio/podcasts`); podcast = data.podcasts[0]; return data.podcasts.length;
    }, { timeout: 30_000 }).toBe(1);
    expect(podcast!.notebook_id).toBe(target.id); expect(podcast!.persistence).toBe('account'); expect(podcast!.source_ids).toEqual([source!.id]);
    const audioPath = `${root}/studio/podcasts/${podcast!.id}/audio`;
    const audio = await page.context().request.get(audioPath); expect(audio.status()).toBe(200);
    const bytes = await audio.body(); expect(bytes.length).toBeGreaterThan(1000); expect(bytes.length).toBe(podcast!.byte_length); expect(sha(bytes)).toBe(podcast!.audio_sha256);
    const signal = await page.evaluate(async input => {
      const context = new AudioContext();
      try { const decoded = await context.decodeAudioData(Uint8Array.from(input).buffer); const samples = decoded.getChannelData(0); let sum = 0; for (const sample of samples) sum += sample * sample; return { duration: decoded.duration, rms: Math.sqrt(sum / samples.length) }; }
      finally { await context.close(); }
    }, [...bytes]);
    expect(signal.duration).toBeGreaterThan(3); expect(signal.rms).toBeGreaterThan(0.0005);
    checks.push('actual-decodable-account-saved-podcast');

    const paths = [root, `${root}/sources`, `${root}/sources/${source!.id}/content`, `${root}/messages`, `${root}/studio/decks`, `${root}/studio/decks/${deck.id}`, `${root}/studio/podcasts`, `${root}/studio/podcasts/${podcast!.id}`, audioPath];
    phase = 'foreign-account-denial'; const foreign = await fresh(); await authenticate(foreign.page, identity(), true);
    for (const path of paths) expect([403, 404]).toContain((await foreign.context.request.get(path)).status());
    expect((await foreign.context.request.delete(root)).status()).toBe(404);
    const foreignList = await read(foreign.context, '/api/notebooks'); expect(foreignList.some((item: { id: string }) => item.id === target.id)).toBe(false);
    checks.push('foreign-read-and-delete-denial');

    phase = 'fresh-owner-persisted-population'; const restored = await fresh(); await authenticate(restored.page, owner, false);
    await restored.page.getByRole('heading', { name: title, exact: true }).click();
    await restored.page.waitForURL(url => url.pathname === `/notebook/${target.id}`);
    for (const path of paths) expect((await restored.context.request.get(path)).status()).toBe(200);
    const persistedSources = await read(restored.context, `${root}/sources`);
    expect((persistedSources.sources || persistedSources).find((item: { id: string }) => item.id === source!.id).content).toBe(source!.content);
    expect((await deckRead(restored.context)).cards).toEqual(deck.cards);
    expect(sha(await (await restored.context.request.get(audioPath)).body())).toBe(sha(bytes));
    const storedMessages = await read(restored.context, `${root}/messages`);
    const persistedAnswer = (storedMessages.messages || storedMessages).find((message: { role: string; content: string }) => message.role === 'assistant' && message.content === answer!.content);
    expect(persistedAnswer).toBeTruthy();
    const persistedGrounding = persistedAnswer.groundedSources ?? persistedAnswer.grounded_sources;
    expect(typeof persistedGrounding === 'string' ? JSON.parse(persistedGrounding) : persistedGrounding).toEqual(envelope);
    expect((await read(restored.context, '/api/notebooks/studio/podcasts/recent')).podcast.id).toBe(podcast!.id);
    checks.push('fresh-owner-same-source-answer-deck-and-audio');

    phase = 'populated-cancel-and-ui-delete'; await restored.page.goto('/');
    const retained = await createNotebook(restored.page), retainedTitle = `Retained control ${randomUUID()}`;
    await rename(restored.page, retained.title, retainedTitle, retained.id);
    // Sibling is an actual persisted isolation control. Its deck and podcast are
    // saved through public authenticated APIs, reusing already validated Cedar
    // audio. This does not claim a second generated episode or deck journey.
    const siblingRoot = `/api/notebooks/${retained.id}`;
    await tab(restored.page, 'Sources');
    await restored.page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
    await restored.page.getByRole('button', { name: /Pasted Content/ }).click();
    const siblingSourceTitle = `Sibling Cedar ${randomUUID()}`;
    await restored.page.getByLabel('Title', { exact: true }).fill(siblingSourceTitle);
    await restored.page.getByLabel('Content', { exact: true }).fill(content);
    await restored.page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
    let siblingSource: { id: string; content: string; processingStatus: string };
    await expect.poll(async () => {
      const data = await read(restored.context, `${siblingRoot}/sources`);
      siblingSource = (data.sources || data).find((item: { title: string }) => item.title === siblingSourceTitle);
      return Boolean(siblingSource && ['completed', 'degraded'].includes(siblingSource.processingStatus) && normalize(siblingSource.content).includes(normalize(content)));
    }, { timeout: 120_000 }).toBe(true);
    const siblingCards = deck.cards.map((card: { sourceId: string; sourceTitle: string }) => ({ ...card, id: randomUUID(), sourceId: siblingSource!.id, sourceTitle: siblingSourceTitle }));
    const siblingDeckResponse = await restored.context.request.post(`${siblingRoot}/studio/decks`, { data: { name: 'Populated sibling control', cards: siblingCards } });
    expect(siblingDeckResponse.status()).toBe(201);
    const siblingDeck = (await siblingDeckResponse.json()).deck;
    expect(siblingDeck.cards).toHaveLength(3);
    const siblingPodcastResponse = await restored.context.request.post(`${siblingRoot}/studio/podcasts`, { multipart: {
      metadata: JSON.stringify({ id: randomUUID(), title: 'Populated sibling audio control', script, sourceIds: [siblingSource!.id] }),
      audio: { name: 'sibling.wav', mimeType: 'audio/wav', buffer: bytes },
    } });
    expect(siblingPodcastResponse.status()).toBe(201);
    const siblingPodcast = (await siblingPodcastResponse.json()).podcast;
    const siblingAudioPath = `${siblingRoot}/studio/podcasts/${siblingPodcast.id}/audio`;
    const siblingPaths = [siblingRoot, `${siblingRoot}/sources`, `${siblingRoot}/sources/${siblingSource!.id}/content`, `${siblingRoot}/studio/decks`, `${siblingRoot}/studio/decks/${siblingDeck.id}`, `${siblingRoot}/studio/podcasts`, `${siblingRoot}/studio/podcasts/${siblingPodcast.id}`, siblingAudioPath];
    for (const path of siblingPaths) expect((await restored.context.request.get(path)).status()).toBe(200);
    expect(sha(await (await restored.context.request.get(siblingAudioPath)).body())).toBe(sha(bytes));
    // Capture every allowlisted target row and document-version IDs before the
    // parent row disappears, so joins cannot conceal orphaned child records.
    const targetRows = rowAudit.snapshot(target.id), siblingRows = rowAudit.snapshot(retained.id);
    assertPopulated(targetRows); assertPopulated(siblingRows);
    expect(targetRows.sources.ids).toContain(source!.id);
    expect(targetRows.studio_decks.ids).toContain(deck.id);
    expect(targetRows.studio_podcasts.ids).toContain(podcast!.id);
    expect(targetRows.chat_messages.count).toBeGreaterThanOrEqual(2);
    expect(siblingRows.sources.ids).toContain(siblingSource!.id);
    expect(siblingRows.studio_decks.ids).toContain(siblingDeck.id);
    expect(siblingRows.studio_podcasts.ids).toContain(siblingPodcast.id);
    expect(siblingRows.studio_podcasts.blobBytes).toBe(bytes.length);
    for (const path of siblingPaths) expect([403, 404]).toContain((await foreign.context.request.get(path)).status());
    expect((await foreign.context.request.delete(siblingRoot)).status()).toBe(404);
    assertRetained(siblingRows, rowAudit.snapshot(retained.id, siblingRows));
    checks.push('populated-sibling-public-save-and-foreign-denial');
    await restored.page.goto('/');
    const deleteButton = restored.page.getByRole('button', { name: `Delete ${title}`, exact: true });
    await deleteButton.click(); const confirmation = restored.page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: 'Delete this notebook?', exact: true })).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(confirmation).toHaveCount(0);
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    for (const path of paths) expect((await restored.context.request.get(path)).status()).toBe(200);
    expect(sha(await (await restored.context.request.get(audioPath)).body())).toBe(sha(bytes));
    assertRetained(targetRows, rowAudit.snapshot(target.id, targetRows));
    assertRetained(siblingRows, rowAudit.snapshot(retained.id, siblingRows));
    checks.push('cancel-retains-exact-target-and-populated-sibling-rows');
    await deleteButton.click();
    const deleted = restored.page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname === root);
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click(); expect((await deleted).status()).toBe(200);
    await expect(restored.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await restored.page.reload(); await expect(restored.page.getByRole('heading', { name: retainedTitle, exact: true })).toBeVisible();
    assertPurged(rowAudit.snapshot(target.id, targetRows));
    assertRetained(siblingRows, rowAudit.snapshot(retained.id, siblingRows));
    checks.push('actual-runtime-db-target-rows-and-blob-purged-sibling-intact');
    checks.push('populated-cancel-preserves-resources-and-real-ui-delete');

    phase = 'fresh-owner-deleted-resources'; const after = await fresh(); await authenticate(after.page, owner, false);
    await expect(after.page.getByRole('heading', { name: retainedTitle, exact: true })).toBeVisible();
    await expect(after.page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    const remaining = await read(after.context, '/api/notebooks');
    expect(remaining.some((item: { id: string }) => item.id === target.id)).toBe(false); expect(remaining.some((item: { id: string }) => item.id === retained.id)).toBe(true);
    for (const path of paths) { const denied = await after.context.request.get(path); expect(denied.status()).toBe(404); expect(denied.headers()['content-type'] || '').not.toMatch(/^audio\//); }
    expect((await read(after.context, '/api/notebooks/studio/podcasts/recent')).podcast.id).toBe(siblingPodcast.id);
    for (const path of siblingPaths) expect((await after.context.request.get(path)).status()).toBe(200);
    const siblingSources = await read(after.context, `${siblingRoot}/sources`);
    expect((siblingSources.sources || siblingSources).find((item: { id: string }) => item.id === siblingSource!.id).content).toBe(siblingSource!.content);
    expect((await read(after.context, `${siblingRoot}/studio/decks/${siblingDeck.id}`)).deck.cards).toEqual(siblingDeck.cards);
    expect(sha(await (await after.context.request.get(siblingAudioPath)).body())).toBe(sha(bytes));
    assertPurged(rowAudit.snapshot(target.id, targetRows));
    assertRetained(siblingRows, rowAudit.snapshot(retained.id, siblingRows));
    expect((await after.context.request.get(`/api/notebooks/${retained.id}`)).status()).toBe(200);
    await after.page.goto(`/notebook/${target.id}`);
    await expect(after.page.getByRole('heading', { name: 'Notebook Not Found', exact: true })).toBeVisible();
    expect((await after.context.request.get(root)).status()).toBe(404); // Tombstone must prevent read-driven resurrection.
    assertPurged(rowAudit.snapshot(target.id, targetRows));
    assertRetained(siblingRows, rowAudit.snapshot(retained.id, siblingRows));
    physicalRowAndBlobPurgeVerified = true; populatedSiblingRetained = true;
    checks.push('fresh-owner-target-db-purge-and-identical-populated-sibling');
    checks.push('fresh-owner-deleted-list-source-chat-deck-podcast-and-audio-denied-with-live-sibling'); phase = 'passed';
  } finally {
    countDiagnostic.stop(); page.off('console', diagnosticConsole);
    await info.attach(attachmentName, { body: Buffer.from(JSON.stringify(countDiagnostic.snapshot())), contentType: 'application/json' });
    // Accepted only when the separately reviewed schema-2 contract matches this complete journey.
    await info.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(info, { phase, checks, physicalRowAndBlobPurgeVerified, populatedSiblingRetained, secureStorageErasureVerified: false, siblingGenerationVerified: false }))), contentType: 'application/json' });
    rowAudit.close();
    await Promise.all(contexts.map(context => context.close()));
  }
});
