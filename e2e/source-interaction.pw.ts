import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page, type BrowserContext, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Real isolated accounts and UI writes; no seeded/auth/provider/data mocks.
// Rename recovery deliberately aborts one exact owned-source title PUT before forwarding.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const retainedFact = /17 blue trays/i;
interface Source { id: string; title: string; content: string; processingStatus: string }

async function authenticate(page: Page, email: string, signup: boolean) {
  await page.goto(`/auth?mode=cloud-${signup ? 'signup' : 'login'}`);
  if (signup) await page.getByLabel('Display Name').fill(`Cedar interaction ${randomUUID()}`);
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.STUDYPOD_AUTH_PASSWORD!);
  if (signup) await page.locator('#tosAccepted').click();
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/auth/${signup ? 'signup' : 'signin'}`));
  await page.getByRole('button', { name: signup ? 'Create Account' : 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(signup ? 201 : 200);
  await expect(page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first()).toBeVisible();
  const profile = await page.context().request.get('/api/user/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(email);
}

async function sources(context: BrowserContext, notebookId: string): Promise<Source[]> {
  const response = await context.request.get(`/api/notebooks/${notebookId}/sources`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  const records = body.sources || body;
  expect(Array.isArray(records)).toBe(true);
  return records;
}

async function openSources(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport!.width < 1100) {
    const tab = page.getByRole('tab', { name: /(?:^|\s)Sources$/ });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAccessibleName('Sources');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Sources', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
}

function titleControl(page: Page, title: string) {
  return page.locator('span.text-sm.font-medium').and(page.getByText(title, { exact: true }));
}

async function viewFact(page: Page, notebookId: string, title: string) {
  await page.goto(`/notebook/${notebookId}`);
  await openSources(page);
  await titleControl(page, title).click();
  await expect(page.locator('.prose').filter({ hasText: retainedFact }).first()).toBeVisible();
}

for (const interaction of ['drop', 'rename'] as const) {
  test(`source-interaction-${interaction}: UI intake, durable content and private ownership`, async ({ page, context, browser }, testInfo) => {
    test.setTimeout(240_000);
    expect(process.env.STUDYPOD_FULL_ISOLATED).toBe('1');
    expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
    expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
    expect(process.env.STUDYPOD_AUTH_PASSWORD).toBeTruthy();
    expect(process.env.STUDYPOD_FULL_FIXTURES).toBeTruthy();
    expect(process.env.STUDYPOD_AUTH_TERMS_ACCEPTED).toBe('1');
    const fixturePath = resolve(process.env.STUDYPOD_FULL_FIXTURES!, 'cedar.txt');
    const fixtureText = readFileSync(fixturePath, 'utf8');
    expect(fixtureText).toMatch(retainedFact);
    const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
    mkdirSync(artifactRoot, { recursive: true });
    // Credentials and raw exceptions deliberately stay out of the public receipt.
    const receipt: Record<string, unknown> = { interaction, target: 'http://127.0.0.1:4182', mockedAuthOrData: false, phase: 'signup', status: 'running' };
    const persist = () => writeFileSync(resolve(artifactRoot, `${testInfo.project.name}-source-interaction-${interaction}.json`), JSON.stringify(receipt, null, 2));
    let pageErrorCount = 0;
    page.on('pageerror', () => { pageErrorCount++; });
    const extraContexts: BrowserContext[] = [];
    const newContext = async () => {
      const fresh = await browser.newContext({ baseURL: 'http://127.0.0.1:4182', serviceWorkers: 'block', viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
      extraContexts.push(fresh);
      return fresh;
    };
    persist();
    try {
      const email = `interaction-${randomUUID()}@studypod.invalid`;
      await authenticate(page, email, true);
      await page.getByRole('button', { name: /^(Create notebook|\+ Create new)$/ }).first().click();
      await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
      const notebookId = new URL(page.url()).pathname.split('/').pop()!;
      receipt.notebookId = notebookId;
      receipt.phase = 'intake'; persist();
      await openSources(page);
      await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
      if (interaction === 'drop') {
        const dropzone = page.getByRole('button', { name: 'Upload source files', exact: true });
        await expect(dropzone).toBeVisible();
        const transfer = await page.evaluateHandle(({ text }) => {
          const data = new DataTransfer();
          data.items.add(new File([text], 'cedar-drop.txt', { type: 'text/plain' }));
          return data;
        }, { text: fixtureText });
        try {
          await dropzone.dispatchEvent('dragenter', { dataTransfer: transfer });
          await dropzone.dispatchEvent('dragover', { dataTransfer: transfer });
          await dropzone.dispatchEvent('drop', { dataTransfer: transfer });
        } finally { await transfer.dispose(); }
        receipt.intakeMechanism = 'browser File/DataTransfer through real drop handler';
      } else {
        const picker = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await (await picker).setFiles(fixturePath);
        receipt.intakeMechanism = 'native file chooser';
      }
      let source!: Source;
      await expect.poll(async () => {
        const records = await sources(context, notebookId);
        if (records.length !== 1) return false;
        source = records[0];
        return retainedFact.test(source.content || '') && ['completed', 'degraded'].includes(source.processingStatus);
      }, { timeout: 120_000, message: 'The real intake must save exactly one usable source' }).toBe(true);
      receipt.sourceId = source.id;
      const fixtureServerTitle = interaction === 'drop' ? 'cedar-drop.txt' : 'cedar.txt';
      expect(source.title).toBe(fixtureServerTitle);
      let expectedServerTitle = fixtureServerTitle;
      // Independent fixture expectation: the source list hides the file suffix
      // and displays the known dropped filename with spaces. User renames stay literal.
      let displayTitle = interaction === 'drop' ? 'cedar drop' : 'cedar';
      if (interaction === 'rename') {
        receipt.phase = 'rename-server-persistence'; persist();
        await titleControl(page, displayTitle).click({ button: 'right' });
        const rename = page.getByRole('menuitem', { name: /(?:^|\s)Rename source$/ });
        await expect(rename).toBeVisible();
        await expect(rename).toHaveAccessibleName('Rename source');
        await rename.click();
        const dialog = page.getByRole('dialog');
        displayTitle = `Cedar renamed ${randomUUID()}`;
        await dialog.locator('#source-name').fill(displayTitle);
        receipt.phase = 'rename-targeted-transport-failure';
        receipt.intentionalFaultInjection = 'one exact owned-source title PUT aborted before forwarding; browser remains online';
        persist();
        // Offline mode pauses React Query before fetch; abort a dispatched owned
        // title write instead, while real auth, reads and all other writes work.
        const ownedPath = `/api/notebooks/${notebookId}/sources/${source.id}`;
        const ownedUrl = (url: URL) => url.pathname === ownedPath;
        let abortedWrites = 0;
        const abortRename = async (route: Route) => {
          const request = route.request();
          const body: unknown = request.method() === 'PUT' ? request.postDataJSON() : null;
          if (abortedWrites === 0 && body && typeof body === 'object'
            && 'title' in body && body.title === displayTitle) {
            abortedWrites++;
            receipt.abortedOwnedRenameWrites = abortedWrites;
            persist();
            await route.abort('failed');
          } else { await route.continue(); }
        };
        await page.route(ownedUrl, abortRename);
        try {
          const failedSave = page.waitForEvent('requestfailed', {
            predicate: request => request.method() === 'PUT' && new URL(request.url()).pathname === ownedPath,
          });
          await dialog.getByRole('button', { name: 'Save', exact: true }).click();
          await failedSave;
          expect(abortedWrites).toBe(1);
          await expect(dialog).toBeVisible();
          await expect(dialog.locator('#source-name')).toHaveValue(displayTitle);
          await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
        } finally { await page.unroute(ownedUrl, abortRename); }
        const afterFailure = await sources(context, notebookId);
        expect(afterFailure).toHaveLength(1);
        expect(afterFailure[0].id).toBe(source.id);
        expect(afterFailure[0].title).toBe(source.title);
        expect(afterFailure[0].content).toBe(source.content);
        receipt.failedRenameRetainsDialogAndServer = true;
        receipt.phase = 'rename-retry-server-persistence'; persist();
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        // A toast/localStorage change alone must fail this authenticated gate.
        await expect.poll(async () => {
          const records = await sources(context, notebookId);
          return records.length === 1 && records[0].id === source.id && records[0].title === displayTitle && records[0].content === source.content;
        }, { timeout: 20_000, message: 'Rename must persist on the owner server without replacing source content' }).toBe(true);
        expectedServerTitle = displayTitle;
        receipt.serverRenamePersisted = true;
      }
      receipt.phase = 'reload-viewer'; persist();
      await page.reload();
      await openSources(page);
      await titleControl(page, displayTitle).click();
      await expect(page.locator('.prose').filter({ hasText: retainedFact }).first()).toBeVisible();
      receipt.reloadViewerFact = true;
      receipt.phase = 'fresh-owner-login'; persist();
      const fresh = await newContext();
      const ownerPage = await fresh.newPage();
      ownerPage.on('pageerror', () => { pageErrorCount++; });
      await authenticate(ownerPage, email, false);
      const persisted = await sources(fresh, notebookId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBe(source.id);
      expect(persisted[0].content).toBe(source.content);
      expect(persisted[0].title).toBe(expectedServerTitle);
      await viewFact(ownerPage, notebookId, displayTitle);
      receipt.freshLoginViewerFact = true;
      receipt.phase = 'foreign-account-denial'; persist();
      const foreign = await newContext();
      const foreignPage = await foreign.newPage();
      await authenticate(foreignPage, `foreign-interaction-${randomUUID()}@studypod.invalid`, true);
      for (const path of [`/api/notebooks/${notebookId}`, `/api/notebooks/${notebookId}/sources`]) {
        const denied = await foreign.request.get(path);
        expect([403, 404]).toContain(denied.status());
        const body = await denied.text();
        expect(body).not.toMatch(retainedFact);
        expect(body).not.toContain(source.content);
        expect(body).not.toContain(displayTitle);
      }
      const unchanged = await sources(fresh, notebookId);
      expect(unchanged).toHaveLength(1);
      expect(unchanged[0].id).toBe(source.id);
      expect(unchanged[0].content).toBe(source.content);
      expect(unchanged[0].title).toBe(persisted[0].title);
      receipt.foreignAccountDenied = true;
      expect(pageErrorCount).toBe(0);
      receipt.phase = 'complete'; receipt.status = 'passed';
    } catch (error) {
      receipt.status = 'failed';
      throw error;
    } finally {
      receipt.pageErrorCount = pageErrorCount;
      persist();
      await testInfo.attach('sanitized-acceptance-receipt', {
        body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json',
      });
      for (const extra of extraContexts) await extra.close();
    }
  });
}

// Bookmark URL -> Signal Queue has no visible action while
// FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE is false. Backend-only drafts are not UI acceptance.
