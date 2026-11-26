import { test, expect } from '@playwright/test';
import { checkLayout, checkProfileKeyboard, observeBrowser } from './helpers';

test.beforeEach(() => {
  expect(process.env.STUDYPOD_BASE_URL, 'Guest mutation suite is restricted to local preview').toBeUndefined();
});

test('guest dashboard: keyboard, open-source link, and missing-route recovery', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create notebook', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^(Code|Open source) on GitHub$/i })).toHaveAttribute('href', 'https://github.com/SantanDon/studypod');
  await checkProfileKeyboard(page);
  await checkLayout(page);
  await page.screenshot({ path: testInfo.outputPath('guest-dashboard.png'), fullPage: true });
  await page.goto('/acceptance-missing-route');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to Home' }).click();
  await expect(page.getByRole('button', { name: 'Create notebook', exact: true })).toBeVisible();
  await verify();
});

test('guest notebook persists and exposes sources, chat, studio, and honest audio recovery', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.goto('/');
  const create = page.getByRole('button', { name: 'Create notebook', exact: true });
  await create.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/notebook\/[a-zA-Z0-9-]+/);
  const notebookUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Add a source to get started' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notebook-workspace.png'), fullPage: true });
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('tab', { name: 'Sources', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add a source to get started' })).toBeVisible();
    await page.getByRole('tab', { name: 'Chat', exact: true }).press('ArrowRight');
    const studioTab = page.getByRole('tab', { name: 'Studio', exact: true });
    await expect(studioTab).toBeFocused();
    await expect(studioTab).toHaveAttribute('aria-selected', 'true');
  } else {
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
  const audiobook = page.getByRole('button', { name: /^Audiobook\b/ });
  await expect(audiobook).toBeVisible();
  if (testInfo.project.name === 'mobile-390') {
    const target = await audiobook.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  // Use the browser's tab order so removing the control from keyboard navigation fails this test.
  for (let step = 0; step < 40; step++) {
    if (await audiobook.evaluate(button => button === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(audiobook).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('audiobook-workspace')).toBeVisible();
  await expect(page.getByTestId('audiobook-local-beta')).toBeVisible();
  for (const id of ['audiobook-add-book', 'audiobook-create-full', 'audiobook-book-upload']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await checkLayout(page);
  await page.screenshot({ path: testInfo.outputPath('audio-unavailable.png'), fullPage: true });
  await page.getByTestId('nav-home').click();
  await expect(page).toHaveURL(new URL('/', notebookUrl).href);
  await page.reload();
  await expect(page.getByText(/New Notebook [—-] /).first()).toBeVisible();
  const savedNotebook = page.getByRole('button', { name: /Open New Notebook [—-] / }).first();
  await page.screenshot({ path: testInfo.outputPath('notebook-library.png'), fullPage: true });
  await savedNotebook.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(notebookUrl);
  await expect(page.getByRole('heading', { name: 'Add a source to get started' })).toBeVisible();
  await verify();
});

test('a first-time visitor can preview and edit a sample source', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Add a source', exact: true }).last().click();
  await page.getByRole('button', { name: /Pasted Content/ }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('button', { name: 'Try a sample' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('School garden experiment');
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(/twelve bean seedlings/);
  await dialog.getByLabel('Title', { exact: true }).fill('My garden study');
  await expect(dialog.getByRole('button', { name: 'Add Copied Text', exact: true })).toBeEnabled();
  await testInfo.attach('sample-accessibility-tree', { body: await dialog.ariaSnapshot(), contentType: 'text/plain' });
  await verify();
});

test('revision planner answers and opens the exact saved passage after reload', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the revision planner' }).click();
  const chat = page.getByRole('textbox', { name: 'Chat message' });
  await chat.fill('What should I do on Friday?');
  await chat.press('Enter');
  const citation = page.getByRole('button', { name: 'Citation 1', exact: true });
  await expect(citation).toBeVisible();
  await page.reload();
  if (testInfo.project.name === 'desktop') {
    await citation.focus();
    await page.keyboard.press('Enter');
  } else {
    const citationBox = await citation.boundingBox();
    expect(citationBox?.width).toBeGreaterThanOrEqual(44);
    expect(citationBox?.height).toBeGreaterThanOrEqual(44);
    await citation.tap();
  }
  const line = page.locator('[data-cited-line="9"]:visible');
  await expect(line).toContainText('Friday — Close your notes and take a three-question practice quiz.');
  await expect(page.locator('[data-cited-line]:visible')).toHaveCount(1);
  await expect(line).toBeInViewport({ ratio: 0.98 });
  await page.screenshot({ path: testInfo.outputPath('revision-passage.png') });
  if (testInfo.project.name === 'mobile-390') {
    const sections = page.getByRole('tablist', { name: 'Notebook sections' });
    const sources = sections.getByRole('tab', { name: 'Sources' });
    await expect(sources).toHaveAttribute('aria-selected', 'true');
    expect((await sources.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Back to Chat' }).press('Enter');
    await expect(citation).toBeFocused();
    await sections.getByRole('tab', { name: 'Chat' }).press('ArrowLeft');
    await expect(sources).toBeFocused();
    await sources.press('ArrowRight');
    await expect(sections.getByRole('tab', { name: 'Chat' })).toBeFocused();
  }
  await chat.fill('Orbital velocity of Saturn?');
  await chat.press('Enter');
  await expect(page.getByText(/couldn't find a matching passage/).first()).toBeVisible();
  await verify();
});

test('custom field notebook opens its saved passage after reload', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.addInitScript(() => localStorage.setItem('studypod.localInference.enabled', 'false'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Add a source', exact: true }).last().click();
  await page.getByRole('button', { name: /Pasted Content/ }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Title', { exact: true }).fill('Field equipment inventory');
  const passage = 'The spare spectrometer is stored in the amber cabinet.';
  await dialog.getByLabel('Content', { exact: true }).fill(['Field equipment inventory', '', 'Bench supplies are stored in the blue cupboard.', passage, 'Sign equipment out before collecting it.'].join('\n'));
  await dialog.getByRole('button', { name: 'Add Copied Text', exact: true }).click();
  const chat = page.getByRole('textbox', { name: 'Chat message' });
  if (testInfo.project.name === 'mobile-390') await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await chat.fill('Find passage: Where is the spare spectrometer stored?');
  await chat.press('Enter');
  const citation = page.getByRole('button', { name: 'Citation 1', exact: true });
  await expect(citation).toBeVisible();
  await page.reload();
  await citation.click();
  await expect(page.locator('[data-cited-line="4"]:visible')).toHaveText(new RegExp(passage));
  await page.screenshot({ path: testInfo.outputPath('field-equipment-passage.png') });
  await verify();
});
