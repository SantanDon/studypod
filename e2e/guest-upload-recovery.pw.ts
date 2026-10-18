import { acceptanceReceipt } from './acceptance-contracts.mjs';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Real guest storage, native file picker, and real extraction. No mocked responses,
// injected notebook records, or preloaded quota state are permitted in this gate.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off', screenshot: 'off' });

type Fixture = { name: string; mimeType: string; buffer: Buffer; title: string; fact: string };
const textFixture = (title: string, fact: string): Fixture => ({
  name: `${title}.txt`, title, fact, mimeType: 'text/plain',
  buffer: Buffer.from(`${title}\n\n${fact}\n\nThis fictional Cedar training notebook contains synthetic inventory records for browser acceptance testing. The station keeper records each jar before the morning inspection. These records belong to an imaginary classroom exercise and contain no personal information. The inventory statement above is the retained fact that a reader must be able to reopen after refreshing the notebook.`, 'utf8'),
});

async function sourcesTab(page: Page) {
  const tab = page.getByRole('tab', { name: 'Sources', exact: true });
  const viewport = page.viewportSize();
  expect(viewport, 'The acceptance project must declare its viewport').not.toBeNull();
  // Notebook uses desktop columns at 1100px; smaller screens use mobile tabs.
  // Auto-retrying assertions also wait for useViewport's initial effect to settle.
  if (viewport!.width >= 1100) {
    await expect(tab).toHaveCount(0);
  } else {
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
}

async function returnToSourceList(page: Page) {
  const back = page.getByRole('button', { name: 'Back to source list', exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(back).toBeHidden();
  await sourcesTab(page);
}

function sourceTitle(page: Page, title: string) {
  return page.locator('span.text-sm.font-medium').and(page.getByText(title, { exact: true }));
}

function sourceCard(page: Page, title: string) {
  return sourceTitle(page, title)
    .locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
}

async function addDialog(page: Page) {
  await sourcesTab(page);
  await page.getByRole('button', { name: /(?:^|\s)Add$|^Add a source$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add sources', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function uploadThroughPicker(page: Page, files: Fixture[]) {
  const dialog = await addDialog(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse files', exact: true }).click();
  await (await chooser).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  await expect(dialog).toBeHidden();
}

async function verifyRetainedFact(page: Page, fixture: Fixture) {
  await sourcesTab(page);
  await expect(sourceCard(page, fixture.title).getByText('Ready', { exact: true })).toBeVisible({ timeout: 90_000 });
  await sourceTitle(page, fixture.title).click();
  await expect(page.locator('.prose').filter({ hasText: fixture.fact }).first()).toBeVisible();
  await returnToSourceList(page);
  // The reader replaces the Sources heading; its back button restores the list.
  await expect(sourceTitle(page, fixture.title)).toBeVisible();
}

async function verifyRemaining(page: Page, count: number) {
  const dialog = await addDialog(page);
  await expect(dialog).toContainText(count === 0
    ? 'This guest notebook has reached its source limit. Sign in to add more sources.'
    : `You can add ${count} more source${count === 1 ? '' : 's'} to this guest notebook.`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('guest-upload-recovery: failed extraction persists and deletion restores a replacement slot', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  expect(process.env.STUDYPOD_FULL_ISOLATED, 'Run only in the dedicated local release candidate').toBe('1');
  expect(process.env.STUDYPOD_AUTH_MUTATIONS_ALLOWED).toBe('dedicated-test-data');
  expect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:4182');
  const stages: string[] = [];
  const diagnostics: unknown[] = [];
  page.on('pageerror', error => diagnostics.push({ type: 'pageerror', message: error.message }));
  const originals = [17, 23, 29, 31].map((jars, index) => textFixture(
    `Cedar recovery station ${index + 1}`, `Cedar recovery station ${index + 1} stores exactly ${jars} blue sample jars.`,
  ));
  const broken: Fixture = {
    name: 'Cedar corrupt archive.docx', title: 'Cedar corrupt archive', fact: '',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('Synthetic corrupt DOCX fixture. This is deliberately not a ZIP archive.', 'utf8'),
  };
  const replacement = textFixture('Cedar replacement station', 'Cedar replacement station stores exactly 43 amber sample jars.');
  let outcome = 'failed';
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
    await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
    stages.push('fresh-guest-notebook-created');
    await verifyRemaining(page, 5);
    await uploadThroughPicker(page, originals);
    for (const fixture of originals) await verifyRetainedFact(page, fixture);
    await verifyRemaining(page, 1);
    stages.push('four-native-txt-uploads-ready-with-readable-facts');

    await uploadThroughPicker(page, [broken]);
    const failed = sourceCard(page, broken.title);
    await expect(failed.getByText('Failed', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(failed.getByText('Ready', { exact: true })).toHaveCount(0);
    await expect(failed.getByText(/^(Processing|Chat ready)/)).toHaveCount(0);
    const details = failed.locator('p');
    await expect(details).toContainText(/extracting:/i);
    await expect(details).toContainText(/DOCX|zip|central directory/i);
    const durableError = await details.innerText();
    // Reload clears transient notifications; the saved source failure must remain.
    await page.reload();
    await sourcesTab(page);
    await expect(sourceCard(page, broken.title).getByText('Failed', { exact: true })).toBeVisible();
    await expect(sourceCard(page, broken.title).locator('p')).toHaveText(durableError);
    await expect(sourceCard(page, broken.title).getByText('Ready', { exact: true })).toHaveCount(0);
    for (const fixture of originals) await verifyRetainedFact(page, fixture);
    await verifyRemaining(page, 0);
    stages.push('fifth-corrupt-docx-durable-extraction-failure-quota-zero');

    await sourceTitle(page, broken.title).click({ button: 'right' });
    // Scope to the real context-menu item while ignoring decorative icon glyphs.
    const remove = page.getByRole('menuitem').filter({ hasText: /^\s*Remove source\s*$/ });
    await expect(remove).toBeVisible();
    await expect(remove).toHaveAccessibleName('Remove source');
    await remove.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(`Delete ${broken.name}?`);
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sourceTitle(page, broken.title)).toHaveCount(0);
    await page.reload();
    await sourcesTab(page);
    await expect(sourceTitle(page, broken.title)).toHaveCount(0);
    await verifyRemaining(page, 1);
    stages.push('visible-failed-source-deletion-restores-slot-after-reload');

    await uploadThroughPicker(page, [replacement]);
    await verifyRetainedFact(page, replacement);
    await page.reload();
    for (const fixture of [...originals, replacement]) await verifyRetainedFact(page, fixture);
    await expect(sourceTitle(page, broken.title)).toHaveCount(0);
    await verifyRemaining(page, 0);
    stages.push('replacement-native-upload-and-all-five-facts-survive-reload');
    outcome = 'passed';
  } finally {
    const artifactRoot = process.env.STUDYPOD_AUTH_ARTIFACTS || testInfo.outputDir;
    await mkdir(artifactRoot, { recursive: true });
    if (!page.isClosed()) {
      try {
        diagnostics.push(await page.evaluate(() => ({
          type: 'final-guest-state', url: location.pathname,
          headings: [...document.querySelectorAll('h1,h2')].map(node => node.textContent),
          readerOpen: Boolean(document.querySelector('.prose')),
          visibleSourceTitles: [...document.querySelectorAll('span.text-sm.font-medium')].map(node => node.textContent),
          sources: JSON.parse(localStorage.getItem('sources') || '[]').map((source: {
            id: string; title: string; processing_status: string; content?: string;
            metadata?: { processingStage?: string; processingError?: unknown };
          }) => ({ id: source.id, title: source.title, status: source.processing_status,
            contentLength: source.content?.length || 0,
            processingStage: source.metadata?.processingStage, error: source.metadata?.processingError })),
          quota: JSON.parse(localStorage.getItem('guest_mode_data') || 'null'),
        })));
      } catch (error) { diagnostics.push({ type: 'capture-failed', message: String(error) }); }
    }
    await writeFile(join(artifactRoot, `guest-upload-recovery-${testInfo.project.name}.diagnostics.private.json`), JSON.stringify(diagnostics, null, 2));
    const receipt = {
      scenario: 'guest-upload-recovery', project: testInfo.project.name, outcome, stages,
      fixtures: [...originals, broken, replacement].map(({ name }) => name),
      boundary: 'Synthetic guest data only; real picker/extraction/UI; no auth, network mocks or storage injection. Reload persistence is within the same guest browser context.',
    };
    await writeFile(join(artifactRoot, `guest-upload-recovery-${testInfo.project.name}.json`), JSON.stringify(receipt, null, 2));
    await testInfo.attach('sanitized-acceptance-receipt', { body: Buffer.from(JSON.stringify(acceptanceReceipt(testInfo, receipt))), contentType: 'application/json' });
  }
});
