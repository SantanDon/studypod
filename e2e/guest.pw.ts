import { test, expect } from '@playwright/test';
import { checkLayout, checkProfileKeyboard, observeBrowser } from './helpers';

test.beforeEach(() => {
  expect(process.env.STUDYPOD_BASE_URL, 'Guest mutation suite is restricted to local preview').toBeUndefined();
});

test('guest dashboard: keyboard, open-source link, and missing-route recovery', async ({ page }, testInfo) => {
  const verify = await observeBrowser(page, testInfo, true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create notebook', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /StudyPod on GitHub/i })).toHaveAttribute('href', 'https://github.com/SantanDon/studypod');
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
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('tab', { name: 'Sources', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add a source to get started' })).toBeVisible();
    await page.getByTestId('mobile-studio-tab').click();
  } else {
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Studio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Audiobook Local beta/ }).click();
  await expect(page.getByTestId('audiobook-workspace')).toBeVisible();
  await expect(page.getByTestId('audiobook-local-beta')).toBeVisible();
  for (const id of ['audiobook-add-book', 'audiobook-create-full', 'audiobook-book-upload']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await checkLayout(page);
  await page.screenshot({ path: testInfo.outputPath('audio-unavailable.png'), fullPage: true });
  await page.getByTestId('nav-home').click();
  await page.reload();
  await expect(page.getByText(/New Notebook [—-] /).first()).toBeVisible();
  await page.goto(notebookUrl);
  await expect(page.getByRole('heading', { name: 'Add a source to get started' })).toBeVisible();
  await verify();
});
