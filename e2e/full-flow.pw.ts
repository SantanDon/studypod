import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { content } from './full-flow-fixtures.mjs';
import { supportedCedarConnection } from './helpers/cedarMapOracle';

type Source = { title: string; content: string; processingStatus: string; extractionMetadata?: unknown; metadata?: unknown; type?: string; mimeType?: string };
type SourceReceipt = { status?: string; contentLength: number; retainedSyntheticFact: boolean; syntheticExtract?: string; fullSyntheticTranscript?: string; extractionMetadata?: unknown; sourceType?: string; mimeType?: string };
type FlowReceipt = Record<string, unknown> & { phase: string; pageErrors: string[]; consoleErrors: string[]; source?: SourceReceipt };
type VisibleControl = { text: string; label: string | null; expanded: string | null };

const sources = ['wav', 'mp3', 'm4a', 'paste', 'txt', 'md', 'pdf', 'docx', 'epub'];
const scenarios = [...sources.map(type => `intake-${type}`), 'corrupt-pdf', 'grounded-chat', 'studio-map', 'studio-flashcards', 'studio-quiz', 'studio-note', 'studio-goal', 'studio-document'];
for (const scenario of scenarios) {
  test(`${scenario}: real isolated browser acceptance`, async ({ page, context }, testInfo) => {
    expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
    const receipt: FlowReceipt = { scenario, project: testInfo.project.name, phase: 'signup', mockedAuthOrData: false, provider: 'local Ollama qwen3.5:9b', target: 'http://127.0.0.1:4182', pageErrors: [], consoleErrors: [] };
    const progress = () => writeFileSync(resolve(process.env.STUDYPOD_AUTH_ARTIFACTS!, `${testInfo.project.name}-${scenario}.progress.json`), JSON.stringify(receipt, null, 2));
    page.on('pageerror', error => receipt.pageErrors.push(error.message.slice(0, 300)));
    receipt.consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') receipt.consoleErrors.push(message.text().slice(0, 500)); });
    const tab = async (name: string) => {
      if ((page.viewportSize()?.width ?? 1280) >= 1100) return;
      const button = page.getByRole('tab', { name, exact: true });
      await expect(button).toBeVisible();
      await button.click();
      await expect(button).toHaveAttribute('aria-selected', 'true');
    };
    const openTool = async (name: RegExp) => { const trigger = page.getByRole('button', { name }).first(); if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click(); };
    try {
      progress();
      const identity = randomUUID();
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`QA ${identity}`);
      await page.getByLabel('Email Address').fill(`flow-${identity}@studypod.invalid`);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      const id = new URL(page.url()).pathname.split('/').pop();
      receipt.phase = 'source-intake'; progress(); await tab('Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      if (scenario === 'corrupt-pdf') {
        await page.locator('#file-upload').setInputFiles(resolve(process.env.STUDYPOD_FULL_FIXTURES!, 'corrupt.pdf'));
        await expect(page.getByText(/Failed to extract PDF|not readable|re-upload|PDF.*failed|Failed to process/i).first()).toBeVisible({ timeout: 30_000 });
        const response = await context.request.get(`/api/notebooks/${id}/sources`);
        const data = await response.json();
        expect((data.sources || data).filter((s: Source) => ['completed', 'degraded'].includes(s.processingStatus))).toHaveLength(0);
        receipt.corruptPdfSavedAsReady = false; receipt.phase = 'passed'; return;
      }
      const type = scenario.startsWith('intake-') ? scenario.slice(7) : 'paste';
      if (type === 'paste') {
        await page.getByRole('button', { name: /Pasted Content/ }).click();
        await page.getByLabel('Title', { exact: true }).fill('Cedar synthetic study');
        await page.getByLabel('Content', { exact: true }).fill(content);
        await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      } else await page.locator('#file-upload').setInputFiles(resolve(process.env.STUDYPOD_FULL_FIXTURES!, `cedar.${type}`));
      let source: Source;
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${id}/sources`);
        const data = await response.json(); source = (data.sources || data)[0];
        receipt.source = { status: source?.processingStatus, contentLength: source?.content?.length || 0, retainedSyntheticFact: /(?:17|seventeen) blue trays/i.test(source?.content || ''), syntheticExtract: source?.content?.slice(0, 600), ...(['wav', 'mp3', 'm4a'].includes(type) ? { fullSyntheticTranscript: source?.content || '', extractionMetadata: source?.extractionMetadata ?? source?.metadata ?? null, sourceType: source?.type, mimeType: source?.mimeType } : {}) }; progress();
        if (['completed', 'degraded'].includes(source?.processingStatus) && !receipt.source.retainedSyntheticFact) throw new Error('Completed extraction lost the reference fact; inspect sanitized synthetic extract');
        return receipt.source.retainedSyntheticFact && ['completed', 'degraded'].includes(source.processingStatus);
      }, { timeout: 120_000, message: 'Real extraction must preserve synthetic fact in usable saved source' }).toBe(true);
      if (['grounded-chat', 'studio-map', 'studio-flashcards', 'studio-quiz'].includes(scenario)) {
        receipt.phase = 'background-source-processing-settle'; receipt.backgroundSettleMs = 46_000; progress();
        // Source mastication uses the same local model. Let its real 45-second budget expire
        // before foreground acceptance, so this scenario measures the requested task.
        await page.waitForTimeout(46_000);
      }
      if (scenario.startsWith('intake-')) {
        receipt.phase = 'source-viewer'; progress();
        const displayTitle = source.title.replace(/\.(?:txt|md|markdown|pdf|docx|epub)$/i, '');
        await page.getByText(displayTitle, { exact: true }).first().click({ timeout: 15_000 });
        await expect(page.locator('.prose').filter({ hasText: /(?:17|seventeen) blue trays/i }).first()).toBeVisible();
        receipt.viewerFactVisible = true;
        await page.reload(); await tab('Sources');
        await page.getByText(displayTitle, { exact: true }).first().click();
        await expect(page.locator('.prose').filter({ hasText: /(?:17|seventeen) blue trays/i }).first()).toBeVisible();
        receipt.reopenedAfterReload = true;
      } else if (scenario === 'grounded-chat') {
        receipt.phase = 'grounded-chat'; progress(); await tab('Chat');
        const input = page.getByPlaceholder(/Start typing|Ask only/);
        await expect(input).toBeEnabled();
        await input.fill('According to the Cedar experiment source, exactly how many blue trays are used? Give the number and cite the source.');
        await input.press('Enter');
        await expect.poll(async () => {
          const response = await context.request.get(`/api/notebooks/${id}/messages`);
          const data = await response.json(); const messages = data.messages || data;
          return Array.isArray(messages) && messages.some(m => m.role === 'assistant' && /17|seventeen/i.test(m.content));
        }, { timeout: 65_000, message: 'Real persisted grounded answer must contain source fact' }).toBe(true);
        await expect(page.getByRole('button', { name: /^Citation 1/ }).first()).toBeVisible();
        const citation = page.getByRole('button', { name: /^Citation 1/ }).first();
        await citation.focus(); await citation.press('Enter');
        await expect(citation).toHaveAttribute('aria-expanded', 'true');
        const evidenceId = await citation.getAttribute('aria-controls');
        await expect(page.locator(`[id="${evidenceId}"]`)).toContainText(/17|seventeen/i);
        await citation.press('Space'); await expect(citation).toHaveAttribute('aria-expanded', 'false');
        await page.reload(); await tab('Chat');
        await expect(page.getByRole('button', { name: /^Citation 1/ }).first()).toBeVisible();
        receipt.chat = 'persisted source fact, keyboard citation excerpt, reload';
      } else {
        receipt.phase = scenario; progress(); await tab('Studio');
        if (scenario === 'studio-map') {
          // Keep map navigation deterministic on mobile, including after a new document/login.
          const showMap = async (target: typeof page) => {
            if ((target.viewportSize()?.width || 1440) < 1100) {
              const studioTab = target.getByRole('tab', { name: /(?:^|\s)Studio$/ });
              await expect(studioTab).toBeVisible();
              await expect(studioTab).toHaveAccessibleName('Studio');
              await studioTab.click();
              await expect(studioTab).toHaveAttribute('aria-selected', 'true');
            }
            const tool = target.getByRole('button', { name: /Concept Map/ }).first();
            await expect(tool).toBeVisible();
            if (await tool.getAttribute('aria-expanded') !== 'true') await tool.click();
          };
          const renderedMap = async (target: typeof page) => {
            await expect(target.locator('.react-flow__node').first()).toBeVisible();
            const nodes = target.locator('.react-flow__node');
            const labels = (await nodes.allTextContents()).map(label => label.trim()).sort();
            const concepts = [
              /photosynthesis/i, /chlorophyll/i, /light/i, /water/i,
              /carbon dioxide|\bco2\b/i, /oxygen/i, /sugar|glucose/i,
              /bean|seedling/i, /control/i,
            ];
            const grounded = concepts.filter(concept => labels.some(label => concept.test(label)));
            expect(grounded.length, 'Visible generated map must cover at least three distinct Cedar source concepts').toBeGreaterThanOrEqual(3);
            for (let index = 0; index < await nodes.count(); index++) await expect(nodes.nth(index)).toBeVisible();
            const edges = target.locator('.react-flow__edge');
            expect(await edges.count(), 'Concepts must have rendered connections').toBeGreaterThan(0);
            const relationships = target.locator('.react-flow__edge-text');
            const relationshipLabels = (await relationships.allTextContents()).map(label => label.trim()).filter(Boolean).sort();
            // ReactFlow exposes endpoint IDs in its edge accessible name; resolve them
            // against actual rendered nodes, never a seeded graph or browser-storage fixture.
            const connections = await edges.evaluateAll(elements => {
              const nodeLabels = new Map(Array.from(document.querySelectorAll('.react-flow__node')).map(node => [node.getAttribute('data-id'), node.textContent?.trim() || '']));
              return elements.map(edge => {
                const endpoints = /^Edge from (.+) to (.+)$/.exec(edge.getAttribute('aria-label') || '');
                return { source: nodeLabels.get(endpoints?.[1]) || '', target: nodeLabels.get(endpoints?.[2]) || '', label: edge.querySelector('.react-flow__edge-text')?.textContent?.trim() || '' };
              }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
            });
            const visibleMap = { labels, relationshipLabels, connections, edgeCount: await edges.count() };
            receipt.map = visibleMap; progress();
            expect(connections.some(supportedCedarConnection), 'A directed affirmative edge must express a specific relationship present in the source').toBe(true);
            const unsupportedEdgeIndices = connections.flatMap((connection, index) => supportedCedarConnection(connection) ? [] : [index]);
            expect(unsupportedEdgeIndices, 'Every rendered map edge must be independently source-supported; diagnostics identify unsupported edge indices only').toEqual([]);
            return visibleMap;
          };
          await showMap(page);
          await page.getByRole('button', { name: 'Generate map', exact: true }).click();
          await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 65_000 });
          const generated = await renderedMap(page);
          const mapsResponse = await context.request.get(`/api/notebooks/${id}/studio/maps`);
          expect(mapsResponse.status()).toBe(200);
          const savedMaps = (await mapsResponse.json()).maps as { id: string }[];
          expect(savedMaps).toHaveLength(1);
          const savedMap = savedMaps[0];
          const mapPath = `/api/notebooks/${id}/studio/maps/${savedMap.id}`;
          const savedMapResponse = await context.request.get(mapPath);
          expect(savedMapResponse.status()).toBe(200);
          const authoritativeMap = (await savedMapResponse.json()).map;
          receipt.serverMap = authoritativeMap; progress();
          receipt.map = generated; receipt.phase = 'map-same-browser-reload'; progress();
          await page.reload(); await showMap(page);
          expect(await renderedMap(page), 'Reload must retain the actual concept labels and relationships, not merely node count').toEqual(generated);
          receipt.reopenedAfterReload = true; progress();
          const browser = context.browser(); expect(browser).not.toBeNull();
          const freshContext = () => browser!.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block', viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
          const foreign = await freshContext();
          try {
            const foreignPage = await foreign.newPage();
            await foreignPage.goto('/auth?mode=cloud-signup');
            await foreignPage.getByLabel('Display Name').fill(`Map QA ${randomUUID()}`);
            await foreignPage.getByLabel('Email Address').fill(`map-foreign-${randomUUID()}@studypod.invalid`);
            await foreignPage.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
            await foreignPage.locator('#tosAccepted').click();
            const signup = foreignPage.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/auth/signup'));
            await foreignPage.getByRole('button', { name: 'Create Account', exact: true }).click();
            expect((await signup).status()).toBe(201);
            await expect(foreignPage.getByRole('button', { name: 'Create notebook', exact: true })).toBeVisible();
            for (const suffix of ['', '/sources']) {
              const denied = await foreign.request.get(`/api/notebooks/${id}${suffix}`);
              expect([403, 404], 'Foreign account must not read owner notebook or its source material').toContain(denied.status());
            }
            receipt.foreignNotebookAndSourceDenied = true;
            const foreignMapStatuses = [];
            for (const path of [`/api/notebooks/${id}/studio/maps`, mapPath]) {
              const denied = await foreign.request.get(path);
              expect(denied.status()).toBe(404);
              foreignMapStatuses.push(denied.status());
            }
            const deleteDenied = await foreign.request.delete(mapPath);
            expect(deleteDenied.status()).toBe(404);
            const unchanged = await context.request.get(mapPath);
            expect(unchanged.status()).toBe(200);
            expect((await unchanged.json()).map).toEqual(authoritativeMap);
            receipt.foreignMapApiCoverage = { listAndItem: foreignMapStatuses, delete: deleteDenied.status(), ownerMapUnchanged: true }; progress();
          } finally { await foreign.close(); }
          const owner = await freshContext();
          try {
            receipt.phase = 'map-fresh-owner-login';
            receipt.freshOwnerMapPersistence = 'pending authenticated server hydration'; progress();
            const ownerPage = await owner.newPage();
            await ownerPage.goto('/auth?mode=cloud-login');
            await ownerPage.getByLabel('Email Address').fill(`flow-${identity}@studypod.invalid`);
            await ownerPage.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
            const signin = ownerPage.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/auth/signin'));
            await ownerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
            expect((await signin).status()).toBe(200);
            const ownNotebook = await owner.request.get(`/api/notebooks/${id}`);
            expect(ownNotebook.status()).toBe(200);
            const freshMap = await owner.request.get(mapPath);
            expect(freshMap.status()).toBe(200);
            expect((await freshMap.json()).map).toEqual(authoritativeMap);
            await ownerPage.goto(`/notebook/${id}`); await showMap(ownerPage);
            expect(await renderedMap(ownerPage), 'Fresh owner login must restore saved map without generating again or copying browser storage').toEqual(generated);
            receipt.freshOwnerMapPersistence = 'passed'; progress();
          } catch (error) {
            receipt.freshOwnerMapPersistence = 'failed: authenticated map hydration or visible saved concepts/relationships unavailable'; progress();
            throw error;
          } finally { await owner.close(); }
        } else if (scenario === 'studio-flashcards') {
          await openTool(/^Flashcards/);
          await page.getByRole('button', { name: /(?:^|\s)New Deck$/ }).click();
          await page.getByPlaceholder('Deck name...').fill('Cedar QA deck');
          await page.getByRole('button', { name: /(?:^|\s)Create Deck$/ }).click();
          await page.getByRole('button', { name: /(?:^|\s)Generate$/ }).click();
          const dialog = page.getByRole('dialog');
          const combos = dialog.getByRole('combobox');
          await combos.nth(0).click(); await page.getByRole('option', { name: 'Cedar QA deck', exact: true }).click();
          await combos.nth(1).click(); await page.getByRole('option', { name: source.title, exact: true }).click();
          await combos.nth(2).click(); await page.getByRole('option', { name: '3 cards', exact: true }).click();
          await dialog.getByRole('button', { name: /(?:^|\s)Generate Cards$/ }).click();
          await expect(page.getByRole('button', { name: /(?:^|\s)Review 3 Cards$/ })).toBeVisible({ timeout: 65_000 });
          await page.getByRole('button', { name: /(?:^|\s)Review 3 Cards$/ }).click();
          for (let card = 1; card <= 3; card++) {
            await expect(page.getByText('Card ' + card + ' of 3', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
            await page.getByRole('button', { name: /(?:^|\s)Easy$/ }).click();
          }
          await expect(page.getByText('Session Complete!', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: /(?:^|\s)Done$/ }).click();
          await page.reload(); await tab('Studio'); await openTool(/^Flashcards/);
          await expect(page.getByText('Cedar QA deck', { exact: true })).toBeVisible();
          const deckResponse = await context.request.get(`/api/notebooks/${id}/studio/decks`);
          expect(deckResponse.status()).toBe(200);
          const decks: { name: string; cards: { correctCount: number }[] }[] = (await deckResponse.json()).decks;
          const savedDeck = decks.find(deck => deck.name === 'Cedar QA deck');
          expect(savedDeck.cards).toHaveLength(3);
          expect(savedDeck.cards.every(card => card.correctCount === 1)).toBe(true);
          receipt.flashcardsGeneratedReviewed = 3; receipt.reopenedAfterReload = true;
          receipt.revealInteraction = 'Stable accessible Reveal answer button; real pointer activation verified; keyboard not exercised by this scenario';
        } else if (scenario === 'studio-quiz') {
          await openTool(/^Quiz/);
          await page.getByRole('button', { name: /(?:^|\s)Start Quiz$/ }).click();
          await expect(page.getByRole('button', { name: /(?:^|\s)Submit Answer$/ })).toBeVisible({ timeout: 65_000 });
          receipt.quizQuestionRendered = true;
          await page.getByRole('button', { name: /^A\s/ }).click({ timeout: 15_000 });
          await page.getByRole('button', { name: /(?:^|\s)Submit Answer$/ }).click();
          await expect(page.getByText(/^(Correct!|Explanation)$/).first()).toBeVisible();
          receipt.quizAnswerFeedbackVisible = true;
        } else if (scenario === 'studio-goal') {
          await openTool(/Research Goals/);
          await page.getByRole('button', { name: /Add goal/ }).click();
          await page.getByPlaceholder('e.g. Find improvements for my agents').fill('Compare Cedar controls');
          await page.getByRole('button', { name: 'Save goal', exact: true }).click();
          await expect(page.getByText('Compare Cedar controls', { exact: true }).first()).toBeVisible();
          await page.reload(); await tab('Studio');
          await openTool(/Research Goals/);
          await expect(page.getByText('Compare Cedar controls', { exact: true }).first()).toBeVisible();
          receipt.goalSavedAndVisible = true; receipt.reopenedAfterReload = true;
        } else if (scenario === 'studio-document') {
          await page.getByTestId('open-document-workspace').click();
          await page.getByRole('button', { name: /(?:^|\s)New document$/ }).click();
          await page.getByTestId('document-templates').getByRole('button').first().click();
          await page.getByRole('textbox', { name: 'Document title' }).fill('Cedar QA document');
          await page.getByPlaceholder('Write your document in Markdown…').fill('Cedar QA: 17 blue trays, six hours of light.');
          await page.getByRole('button', { name: /(?:^|\s)Save version$/ }).click();
          await expect(page.getByRole('button', { name: /(?:^|\s)Saved$/ })).toBeVisible();
          await page.reload(); await tab('Studio'); await page.getByTestId('open-document-workspace').click();
          await page.getByRole('heading', { name: 'Cedar QA document', exact: true }).click();
          await expect(page.getByPlaceholder('Write your document in Markdown…')).toHaveValue('Cedar QA: 17 blue trays, six hours of light.');
          receipt.documentSaved = true; receipt.reopenedAfterReload = true;
        } else {
          await page.getByRole('button', { name: /Add note/i }).click();
          await page.getByPlaceholder('Note title').fill('Cedar QA note');
          await page.getByPlaceholder('Write your note here...').fill('17 blue trays; six hours of light.');
          const saveNote = page.getByRole('button', { name: /(?:^|\s)Save$/ }).last();
          await saveNote.click();
          receipt.notePointerSave = true;
          await expect(page.getByText('Cedar QA note', { exact: true }).first()).toBeVisible();
          await page.reload(); await tab('Studio');
          await expect(page.getByText('Cedar QA note', { exact: true }).first()).toBeVisible();
          await page.getByText('Cedar QA note', { exact: true }).first().click();
          await expect(page.getByPlaceholder('Write your note here...')).toHaveValue('17 blue trays; six hours of light.');
          receipt.noteSavedAndVisible = true; receipt.reopenedAfterReload = true;
        }
      }
      expect(receipt.pageErrors).toEqual([]); receipt.phase = 'passed';
    } finally {
      receipt.visibleControls = await page.locator('button,[role=tab]').evaluateAll(elements => elements.filter(e => e.getClientRects().length).map(e => ({ text: (e.textContent || '').trim().slice(0, 120), label: e.getAttribute('aria-label'), expanded: e.getAttribute('aria-expanded') }))).catch((): VisibleControl[] => []);
      progress(); await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
    }
  });
}
