import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import mammoth from 'mammoth';
import { auditCedarExtendedNote } from './helpers/cedarExtendedNoteOracle.mjs';

const evidence = 'The Cedar experiment uses 17 blue trays. Each tray receives six hours of light daily. The control group uses plain water. The treatment group uses nutrient solution. Measurements are recorded at noon. This is synthetic test material.';
const scenarios = ['comparison', 'mission-note', 'goal-synthesis', 'goal-suggestion', 'document-revision', 'audio-chat-open'];
interface SavedNote { id: string; title: string; content: string; storedContent: string }
interface SavedGoal { id: string; title: string; sourceId?: string }
interface SavedSource { id: string; title: string; processingStatus: string; content: string }
interface SavedDocument { id: string; title: string; content: string; currentVersion: number }
interface SavedVersion { version: number; content: string }
interface StudioReceipt {
  [key: string]: unknown;
  phase: string;
  pageErrors: string[];
  checks: string[];
  exports?: { format: string; bytes: number; cedarFactsVerified: number }[];
}
// Match relationships, not incidental digits or a provider's exact prose.
const cedarFacts = [
  /\b(?:17|seventeen)\s+(?:blue\s+)?trays\b/i,
  /\b(?:(?:six|6)(?:\s+|-)(?:hours?|hrs?)|6h(?:\/day)?)\b.{0,100}\blight\b|\blight\b.{0,100}\b(?:(?:six|6)(?:\s+|-)(?:hours?|hrs?)|6h(?:\/day)?)\b/i,
  /\bcontrol\b.{0,100}\bplain water\b|\bplain water\b.{0,100}\bcontrol\b/i,
  /\btreatment\b.{0,100}\bnutrient\b|\bnutrient\b.{0,100}\btreatment\b/i,
];
const assertCedarFacts = (content: string) => {
  const prose = content.replace(/[*_`#]/g, '').replace(/\s+/g, ' ');
  for (const fact of cedarFacts) expect(prose, 'Generated/exported content must preserve each Cedar source relationship').toMatch(fact);
};

for (const scenario of scenarios) {
  test(`studio-extended-${scenario}: real signed-in user acceptance`, async ({ page, context }, testInfo) => {
    test.setTimeout(300_000);
    expect(process.env.STUDYPOD_FULL_ISOLATED, 'Only run against the isolated acceptance deployment').toBe('1');
    expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
    expect(process.env.STUDYPOD_AUTH_ARTIFACTS).toBeTruthy();
    const receipt: StudioReceipt = { scenario, project: testInfo.project.name, phase: 'signup', mockedAuthOrData: false, pageErrors: [], checks: [] };
    const progress = () => writeFileSync(resolve(process.env.STUDYPOD_AUTH_ARTIFACTS!, `${testInfo.project.name}-studio-extended-${scenario}.progress.json`), JSON.stringify(receipt, null, 2));
    page.on('pageerror', error => receipt.pageErrors.push(error.message.slice(0, 300)));
    const viewport = page.viewportSize();
    expect(viewport, 'Acceptance navigation requires a configured viewport').not.toBeNull();
    const usesTabs = viewport!.width < 1100; // Notebook/useViewport desktop breakpoint.
    const tab = async (name: string) => {
      if (!usesTabs) return;
      const control = page.getByRole('tab', { name: new RegExp('(?:^|\\s)' + name + '$') });
      await expect(control).toBeVisible();
      await control.click();
      await expect(control).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
    };
    const open = async (name: RegExp) => { const control = page.getByRole('button', { name }).first(); if (await control.getAttribute('aria-expanded') !== 'true') await control.click(); };
    let notebookId = '';
    let observedGoalSourceId = '';
    const goalApiObservations: { kind: 'goals' | 'suggestions'; status: number; count?: number; acceptedCount?: number; pendingCount?: number; computed?: boolean; rateLimited?: boolean; body: 'pending' | 'parsed' | 'unavailable' }[] = [];
    receipt.goalApiObservations = goalApiObservations;
    // Observe only requests the real UI already made; never refetch for diagnosis.
    page.on('response', response => {
      if (scenario !== 'goal-suggestion' || !notebookId || !observedGoalSourceId || response.request().method() !== 'GET') return;
      const pathname = new URL(response.url()).pathname;
      if (pathname !== `/api/notebooks/${notebookId}/sources/${observedGoalSourceId}/suggested-goals` || goalApiObservations.length >= 8) return;
      const observation: (typeof goalApiObservations)[number] = { kind: 'suggestions', status: response.status(), body: 'pending' };
      goalApiObservations.push(observation);
      void response.json().then((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { observation.body = 'unavailable'; return; }
        const data = raw as Record<string, unknown>;
        if (Array.isArray(data.suggestions)) {
          observation.count = data.suggestions.length;
          observation.acceptedCount = data.suggestions.filter(item => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'accepted').length;
          observation.pendingCount = data.suggestions.filter(item => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'pending').length;
        }
        if (typeof data.computed === 'boolean') observation.computed = data.computed;
        if (typeof data.rateLimited === 'boolean') observation.rateLimited = data.rateLimited;
        observation.body = 'parsed';
      }).catch(() => { observation.body = 'unavailable'; });
    });
    const goalDiagnostics: Record<string, unknown>[] = [];
    receipt.goalActionDiagnostics = goalDiagnostics;
    let goalDiagnosticBudgetMs = 5_000;
    const captureGoalAction = async (kind: 'synthesis' | 'suggestion', stage: 'before-action' | 'locator-failed') => {
      // Diagnostics use independent visible text, never a substitute acceptance click.
      // No goal/source titles, account fields, URLs, IDs or free-form DOM are retained.
      // All captures in this test share one budget; diagnostics cannot multiply timeouts.
      if (goalDiagnosticBudgetMs <= 0) {
        goalDiagnostics.push({ kind, stage, capture: 'budget-exhausted' });
        progress();
        return;
      }
      const started = Date.now();
      const deadline = started + goalDiagnosticBudgetMs;
      const remainingTimeout = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Diagnostic budget exhausted');
        return remaining;
      };
      const collect = async (): Promise<Record<string, unknown>> => {
        try {
        const header = page.getByText('Suggested for this source', { exact: true });
        const synthesisText = page.locator('button').filter({ hasText: /^\s*(?:Synthesize|Syncing\.\.\.)\s*$/ });
        const suggestionRoot = header.locator('..').locator('..');
        const cards = suggestionRoot.locator('div.group.relative');
        const buttons = kind === 'synthesis' ? synthesisText : suggestionRoot.getByRole('button');
        const count = await buttons.count();
        const actions: Record<string, unknown>[] = [];
        let visibleCount = 0;
        for (let i = 0; i < Math.min(count, 16); i++) {
          remainingTimeout();
          const button = buttons.nth(i);
          if (!await button.isVisible()) continue;
          visibleCount++;
          const rawText = (await button.textContent({ timeout: remainingTimeout() }) || '').trim();
          const intendedLabel = /^(?:Synthesize|Syncing\.\.\.|Add|Added)$/.test(rawText) ? rawText : '[redacted unexpected label]';
          // Snapshot one action only, discarding every line except its button role/name.
          const snapshot = await button.ariaSnapshot({ timeout: remainingTimeout() });
          const line = snapshot.split('\n').find(item => /^\s*- button(?:\s|:|$)/.test(item));
          const quoted = line?.match(/^\s*- button\s+("(?:\\.|[^"\\])*")/);
          let accessibleName = '[name unavailable]';
          if (quoted) {
            const decoded: unknown = JSON.parse(quoted[1]);
            // Permit only known action plus whitespace/private-use decorative glyphs.
            // Any unexpected prose is redacted rather than copied into evidence.
            if (typeof decoded === 'string' && /^[\s\uE000-\uF8FF]*(?:Synthesize|Syncing\.\.\.|Add|Added)[\s\uE000-\uF8FF]*$/.test(decoded)) accessibleName = decoded.slice(0, 80);
            else accessibleName = '[redacted unexpected action name]';
          }
          actions.push({ intendedLabel, accessibleName, enabled: await button.isEnabled({ timeout: remainingTimeout() }) });
        }
        const exactAction = kind === 'synthesis' ? page.getByRole('button', { name: 'Synthesize', exact: true }) : suggestionRoot.getByRole('button', { name: 'Add', exact: true });
        const panelControl = page.getByRole('button', { name: /Research Goals/ });
        return { kind, stage, panelControlCount: await panelControl.count(), panelExpanded: await panelControl.count() === 1 ? await panelControl.getAttribute('aria-expanded', { timeout: remainingTimeout() }) : null,
          headerCount: await header.count(), headerVisible: await header.count() === 1 && await header.isVisible(), cardCount: kind === 'suggestion' ? await cards.count() : undefined,
          exactActionCount: await exactAction.count(), candidateButtonCount: count, inspectedLimit: 16, visibleInspectedCount: visibleCount, actions };
        } catch {
        // Do not mask the original failure or serialize a potentially sensitive error.
          return { kind, stage, capture: Date.now() >= deadline ? 'budget-exhausted' : 'unavailable' };
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const diagnostic = await Promise.race([
          collect(),
          new Promise<Record<string, unknown>>(resolve => {
            timer = setTimeout(() => resolve({ kind, stage, capture: 'budget-exhausted' }), goalDiagnosticBudgetMs);
          }),
        ]);
        // Only the race winner may write a receipt; timed-out collection stays local.
        goalDiagnostics.push(diagnostic);
      } finally {
        clearTimeout(timer);
        goalDiagnosticBudgetMs = Math.max(0, goalDiagnosticBudgetMs - (Date.now() - started));
      }
      progress();
    };
    const readCollection = async <T,>(path: string, key: string): Promise<T[]> => {
      const response = await context.request.get(`/api/notebooks/${notebookId}/${path}`);
      expect(response.ok()).toBe(true);
      const data: Record<string, unknown> = await response.json();
      expect(Array.isArray(data[key])).toBe(true);
      if (key === 'goals' && (scenario === 'goal-synthesis' || scenario === 'goal-suggestion') && goalApiObservations.length < 8) {
        goalApiObservations.push({ kind: 'goals', status: response.status(), count: Array.isArray(data[key]) ? data[key].length : undefined, body: 'parsed' });
      }
      return data[key] as T[];
    };
    const readGoals = () => readCollection<SavedGoal>('research-goals', 'goals');
    const readSources = async (): Promise<SavedSource[]> => {
      const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
      expect(response.ok()).toBe(true);
      const sources: unknown = await response.json();
      expect(Array.isArray(sources), 'Source list endpoint returns a raw array').toBe(true);
      return sources as SavedSource[];
    };
    const sourceTitle = (title: string) => page.locator('span.text-sm.font-medium').and(page.getByText(title, { exact: true }));
    const readNotes = async () => {
      const response = await context.request.get(`/api/notebooks/${notebookId}/notes`);
      expect(response.ok()).toBe(true);
      const notes: unknown = await response.json();
      expect(Array.isArray(notes), 'Note list endpoint returns raw stored records').toBe(true);
      return (notes as Record<string, unknown>[]).map(raw => {
        expect(typeof raw.id).toBe('string');
        expect(typeof raw.content).toBe('string');
        // Cloud notes have no title column. Match useNotes' Markdown envelope
        // decoding so the oracle checks the title/body actually shown to users.
        const storedContent = raw.content as string;
        const explicitTitle = typeof raw.title === 'string' ? raw.title : '';
        const heading = !explicitTitle ? /^# ([^\r\n]+)\r?\n(?:\r?\n)?/.exec(storedContent) : null;
        return {
          id: raw.id as string,
          title: explicitTitle || heading?.[1].trim() || 'Untitled Note',
          content: heading ? storedContent.slice(heading[0].length) : storedContent,
          storedContent,
        };
      });
    };
    const addSource = async (title: string, content: string) => {
      await tab('Sources');
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      await page.getByRole('button', { name: /Pasted Content/ }).click();
      await page.getByLabel('Title', { exact: true }).fill(title);
      await page.getByLabel('Content', { exact: true }).fill(content);
      await page.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
      await expect.poll(async () => {
        const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
        expect(response.ok()).toBe(true);
        const data = await response.json();
        const source = ((data.sources || data) as SavedSource[]).find(item => item.title === title);
        return source && ['completed', 'degraded'].includes(source.processingStatus) && source.content?.includes(content);
      }, { timeout: 120_000, message: 'Real saved source must retain all synthetic evidence' }).toBe(true);
    };
    const openSavedNote = async (note: SavedNote) => {
      assertCedarFacts(note.content);
      const quality = auditCedarExtendedNote(note.content);
      receipt.noteQuality = quality;
      progress();
      expect(quality.missing, 'Saved note must preserve all four requested source relationships').toEqual([]);
      expect(quality.contradictions, 'Saved note must not negate or contradict the independent Cedar source oracle').toEqual([]);
      receipt.noteId = note.id;
      await tab('Studio');
      // This intentionally requires immediate discoverability, not a reload workaround.
      await expect(page.getByText(note.title, { exact: true }).first()).toBeVisible();
      await page.getByText(note.title, { exact: true }).first().click();
      await expect(page.getByPlaceholder('Write your note here...')).toHaveValue(note.content);
      assertCedarFacts(await page.getByPlaceholder('Write your note here...').inputValue());
      await page.reload(); await tab('Studio');
      await page.getByText(note.title, { exact: true }).first().click();
      await expect(page.getByPlaceholder('Write your note here...')).toHaveValue(note.content);
      const persisted = (await readNotes()).filter(item => item.id === note.id);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].content).toBe(note.content);
      expect(persisted[0].storedContent).toBe(note.storedContent);
    };
    try {
      progress();
      const identity = randomUUID();
      await page.goto('/auth?mode=cloud-signup');
      await page.getByLabel('Display Name').fill(`Studio QA ${identity}`);
      await page.getByLabel('Email Address').fill(`studio-${identity}@studypod.invalid`);
      await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
      await page.locator('#tosAccepted').click();
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.phase = 'source-intake'; progress();
      await addSource('Cedar protocol', evidence);
      if (scenario === 'comparison') await addSource('Cedar revision', evidence.replace('17 blue trays', '23 blue trays') + ' The revision additionally measures leaf width.');
      // Respect the same real background provider budget as full-flow acceptance.
      if (!['audio-chat-open', 'goal-suggestion'].includes(scenario)) await page.waitForTimeout(46_000);
      receipt.phase = scenario; progress(); await tab('Studio');
      if (scenario === 'comparison') {
        await open(/Compare Sources/);
        await page.getByRole('button', { name: 'Open comparison', exact: true }).click();
        await page.getByRole('combobox', { name: 'First source' }).click();
        await page.getByRole('option', { name: 'Cedar protocol', exact: true }).click();
        await page.getByRole('combobox', { name: 'Second source' }).click();
        await page.getByRole('option', { name: 'Cedar revision', exact: true }).click();
        await expect(page.getByTestId('comparison-scope')).toContainText('3,000');
        await page.getByTestId('run-source-comparison').click();
        // Scope findings to the analysis section, excluding original source text.
        const findings = page.locator('section[aria-labelledby="comparison-analysis-heading"]');
        await expect(page.getByRole('heading', { name: 'Comparison analysis', exact: true })).toBeVisible({ timeout: 90_000 });
        const conflicts = findings.getByRole('heading', { name: 'Conflicts', exact: true }).locator('..').locator('..');
        await expect(conflicts).toContainText(/\b(?:17|seventeen)\b/i);
        await expect(conflicts).toContainText(/\b(?:23|twenty[ -]three)\b/i);
        await expect(conflicts).toContainText(/\btrays?\b/i);
        const revisionOnly = findings.getByRole('heading', { name: 'Only in Cedar revision', exact: true }).locator('..').locator('..');
        await expect(revisionOnly).toContainText(/\bleaf\s+width\b/i);
        await expect(page.getByTestId('source-1-evidence-pane')).toContainText('17 blue trays');
        await expect(page.getByTestId('source-2-evidence-pane')).toContainText('23 blue trays');
        receipt.checks.push('Actual model comparison identifies both conflicting tray counts; original evidence and excerpt boundary visible');
      } else if (scenario === 'mission-note') {
        const before = new Set((await readNotes()).map(note => note.id));
        await open(/Agent Missions/);
        await page.getByLabel('Research mission').fill('Explain the Cedar tray count, daily light duration, plain water control and nutrient treatment, using only the notebook source. Cite the source.');
        await page.getByRole('button', { name: 'Create and run mission', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: /^completed$/ }).first()).toBeVisible({ timeout: 120_000 });
        let note!: SavedNote;
        await expect.poll(async () => { note = (await readNotes()).find(item => !before.has(item.id) && /17|seventeen/i.test(item.content || ''))!; return Boolean(note); }, { timeout: 15_000 }).toBe(true);
        await openSavedNote(note);
        expect(note.content).toMatch(/Cedar protocol|\[\d+\]|\[source\s*\d+\]/i);
        receipt.checks.push('Mission creates a grounded report note visible immediately and after reload');
      } else if (scenario === 'goal-synthesis') {
        const before = new Set((await readNotes()).map(note => note.id));
        const goalTitle = 'Explain Cedar tray count, daily light duration, plain water control and nutrient treatment using source evidence';
        await open(/Research Goals/);
        await page.getByRole('button', { name: /Add goal/ }).click();
        await page.getByPlaceholder('e.g. Find improvements for my agents').fill(goalTitle);
        await page.getByRole('button', { name: 'Save goal', exact: true }).click();
        let savedGoal!: SavedGoal;
        await expect.poll(async () => { const matching = (await readGoals()).filter(item => item.title === goalTitle); savedGoal = matching[0]; return matching.length; }).toBe(1);
        expect(savedGoal.id).toBeTruthy();
        receipt.goalId = savedGoal.id;
        await captureGoalAction('synthesis', 'before-action');
        try {
          await page.getByRole('button', { name: 'Synthesize', exact: true }).click();
        } catch (error) {
          await captureGoalAction('synthesis', 'locator-failed');
          throw error;
        }
        let note!: SavedNote;
        await expect.poll(async () => { note = (await readNotes()).find(item => !before.has(item.id) && /17|seventeen/i.test(item.content || ''))!; return Boolean(note); }, { timeout: 120_000, message: 'A success toast alone is insufficient: synthesis must create a source-grounded artifact' }).toBe(true);
        await openSavedNote(note);
        const persistedGoals = (await readGoals()).filter(item => item.title === goalTitle);
        expect(persistedGoals.map(item => item.id)).toEqual([savedGoal.id]);
        receipt.checks.push('Goal synthesis yields a discoverable persisted source-grounded note');
      } else if (scenario === 'goal-suggestion') {
        const beforeGoals = new Set((await readGoals()).map(item => item.id));
        const ownedSource = (await readSources()).find(item => item.title === 'Cedar protocol')!;
        expect(ownedSource?.id).toBeTruthy();
        observedGoalSourceId = ownedSource.id;
        await tab('Sources'); await sourceTitle('Cedar protocol').click();
        await tab('Studio'); await open(/Research Goals/);
        await expect(page.getByText('Suggested for this source', { exact: true })).toBeVisible({ timeout: 120_000 });
        const card = page.locator('div.group.relative').filter({ has: page.getByRole('button', { name: 'Add', exact: true }) }).first();
        await captureGoalAction('suggestion', 'before-action');
        let suggestionTitle: string | null;
        try {
          suggestionTitle = await card.locator('p').first().textContent();
        } catch (error) {
          await captureGoalAction('suggestion', 'locator-failed');
          throw error;
        }
        expect(suggestionTitle).toBeTruthy();
        try {
          await card.getByRole('button', { name: 'Add', exact: true }).click();
        } catch (error) {
          await captureGoalAction('suggestion', 'locator-failed');
          throw error;
        }
        let acceptedGoal!: SavedGoal;
        await expect.poll(async () => { const matching = (await readGoals()).filter(item => item.title === suggestionTitle); acceptedGoal = matching[0]; return matching.length; }).toBe(1);
        expect(beforeGoals.has(acceptedGoal.id)).toBe(false);
        expect(acceptedGoal.sourceId).toBe(ownedSource.id);
        receipt.goalId = acceptedGoal.id;
        receipt.sourceId = ownedSource.id;
        const acceptedCard = page.locator('div.group.relative').filter({ has: page.getByText(suggestionTitle!, { exact: true }) });
        await expect(acceptedCard.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
        await page.reload(); await tab('Sources'); await sourceTitle('Cedar protocol').click();
        await tab('Studio'); await open(/Research Goals/);
        await expect(acceptedCard.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
        expect((await readGoals()).filter(item => item.title === suggestionTitle).map(item => item.id)).toEqual([acceptedGoal.id]);
        receipt.checks.push('Actual generated suggestion acceptance persists after reload');
      } else if (scenario === 'document-revision') {
        await page.getByTestId('open-document-workspace').click();
        await page.getByRole('button', { name: /(?:^|\s)New document$/ }).click();
        await page.getByTestId('document-templates').getByRole('button').first().click();
        await page.getByRole('textbox', { name: 'Document title' }).fill('Cedar revision acceptance');
        const editor = page.getByPlaceholder('Write your document in Markdown…');
        const original = 'Cedar experiment: 17 blue trays.';
        await editor.fill(original);
        await page.getByRole('checkbox', { name: /Cedar protocol/ }).check();
        await page.getByRole('button', { name: /(?:^|\s)Save version$/ }).click();
        await expect(page.getByRole('button', { name: /(?:^|\s)Saved$/ })).toBeVisible();
        const savedDocuments = (await readCollection<SavedDocument>('documents', 'documents')).filter(item => item.title === 'Cedar revision acceptance');
        expect(savedDocuments).toHaveLength(1);
        const documentId = savedDocuments[0].id;
        const originalVersion = savedDocuments[0].currentVersion;
        expect(savedDocuments[0].content).toBe(original);
        const readDocument = async () => {
          const response = await context.request.get(`/api/notebooks/${notebookId}/documents/${documentId}`);
          expect(response.ok()).toBe(true);
          return (await response.json()).document as SavedDocument;
        };
        receipt.documentId = documentId;
        receipt.originalVersion = originalVersion;
        await page.getByRole('textbox', { name: 'Revision instruction' }).fill('Add the daily light duration and explain control and treatment using the selected source only. Preserve the exact tray count.');
        await page.getByRole('button', { name: 'Revise document', exact: true }).click();
        const proposal = page.getByTestId('document-revision-proposal');
        await expect(proposal).toBeVisible({ timeout: 90_000 });
        await expect(editor).toHaveValue(original);
        await expect(proposal).toContainText('Evidence used');
        await expect(proposal).toContainText('Cedar protocol');
        const revised = await proposal.locator('pre').nth(1).textContent();
        assertCedarFacts(revised!);
        await page.getByRole('button', { name: 'Accept and save version', exact: true }).click();
        await expect(editor).toHaveValue(revised!);
        const acceptedDocument = await readDocument();
        expect(acceptedDocument.content).toBe(revised);
        expect(acceptedDocument.currentVersion).toBeGreaterThan(originalVersion);
        receipt.acceptedVersion = acceptedDocument.currentVersion;
        receipt.exports = [];
        for (const label of ['Word (.docx)', 'PDF', 'MD', 'TXT']) {
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: label, exact: true }).click();
          const download = await pending;
          expect(await download.failure()).toBeNull();
          const stream = await download.createReadStream(); expect(stream).toBeTruthy();
          const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks); expect(bytes.length).toBeGreaterThan(20);
          let exportedText: string;
          if (label === 'PDF') {
            expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
            const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
            const text: string[] = [];
            try {
              for (let index = 1; index <= pdf.numPages; index++) {
                const pdfPage = await pdf.getPage(index);
                const content = await pdfPage.getTextContent();
                text.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
              }
            } finally { await pdf.destroy(); }
            exportedText = text.join(' ');
          } else if (label === 'Word (.docx)') {
            expect(bytes.subarray(0, 2).toString()).toBe('PK');
            exportedText = (await mammoth.extractRawText({ buffer: bytes })).value;
          } else exportedText = bytes.toString();
          assertCedarFacts(exportedText);
          receipt.exports.push({ format: label, bytes: bytes.length, cedarFactsVerified: 4 });
        }
        const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Version history', exact: true }) });
        await history.getByRole('button', { name: 'View', exact: true }).click();
        // View expands history; only Restore is allowed to change the working document.
        await expect(editor).toHaveValue(revised!);
        expect((await readDocument()).currentVersion).toBe(acceptedDocument.currentVersion);
        const versions = await readCollection<SavedVersion>(`documents/${documentId}/versions`, 'versions');
        expect(versions.find(item => item.version === originalVersion)?.content).toBe(original);
        expect(versions.find(item => item.version === acceptedDocument.currentVersion)?.content).toBe(revised);
        const originalRow = history.getByText(`Version ${originalVersion}`, { exact: true }).locator('..').locator('..');
        await originalRow.getByRole('button', { name: 'Restore', exact: true }).click();
        await expect(editor).toHaveValue(original);
        const restored = await readDocument();
        expect(restored.content).toBe(original);
        expect(restored.currentVersion).toBeGreaterThan(acceptedDocument.currentVersion);
        receipt.restoredVersion = restored.currentVersion;
        await page.reload(); await tab('Studio'); await page.getByTestId('open-document-workspace').click();
        await page.getByRole('heading', { name: 'Cedar revision acceptance', exact: true }).click();
        await expect(editor).toHaveValue(original);
        expect((await readDocument()).content).toBe(original);
        const retainedVersions = await readCollection<SavedVersion>(`documents/${documentId}/versions`, 'versions');
        expect(retainedVersions.find(item => item.version === acceptedDocument.currentVersion)?.content).toBe(revised);
        receipt.checks.push('Real grounded proposal is reviewed before acceptance; four downloadable formats; prior version restored and persisted');
      } else {
        await tab('Chat');
        const input = page.getByPlaceholder(/Start typing|Ask only/);
        await input.fill('Open podcast in Studio'); await input.press('Enter');
        let action = page.getByRole('region', { name: 'Chat audio action' });
        // Native section aria-label is exposed as a region by the browser accessibility tree.
        await expect(action.getByRole('button', { name: 'Open in Studio', exact: true })).toBeVisible();
        await action.getByRole('button', { name: 'Open in Studio', exact: true }).click();
        // No helper navigation: the command itself must change the mobile tab.
        const studioTab = page.getByRole('tab', { name: /(?:^|\s)Studio$/ });
        if (usesTabs) {
          await expect(studioTab).toBeVisible();
          await expect(studioTab).toHaveAttribute('aria-selected', 'true');
          await expect(page.getByRole('tabpanel', { name: 'Studio', exact: true })).toBeVisible();
        }
        await expect(page.getByTestId('audio-overview-studio-card')).toBeVisible();
        await tab('Chat');
        await expect(action.getByRole('button', { name: 'Dismiss', exact: true })).toBeEnabled({ timeout: 15_000 });
        await action.getByRole('button', { name: 'Dismiss', exact: true }).click();
        await input.fill('Read audiobook chapter 1 aloud'); await input.press('Enter');
        action = page.getByRole('region', { name: 'Chat audio action' });
        await expect(action).toContainText('This command will not start full-book narration.');
        await expect(action.getByRole('button', { name: 'Confirm generation', exact: true })).toHaveCount(0);
        await expect(action.getByRole('button', { name: 'Open in Studio', exact: true })).toBeVisible();
        await page.reload(); await tab('Chat');
        await expect(page.getByRole('region', { name: 'Chat audio action' })).toHaveCount(0);
        receipt.checks.push('Explicit podcast open routes to Studio; chapter instruction requires selection; reload does not replay draft');
      }
      expect(receipt.pageErrors).toEqual([]); receipt.phase = 'passed';
    } finally {
      progress();
      await testInfo.attach('sanitized-studio-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
    }
  });
}


