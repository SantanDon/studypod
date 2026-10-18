import { expect, type BrowserContext } from '@playwright/test';
import { bootstrapSharedPreview } from './shared-preview-access.mjs';

// Call after installing the suite's unchanged fail-closed mutation policy.
export async function openSharedAccountLogin(context: BrowserContext, origin: string) {
  await bootstrapSharedPreview(context, origin);
  const page = await context.newPage();
  await page.goto('/auth?mode=cloud-login');
  // A successful access-link response alone does not establish app access.
  await expect(page.getByLabel('Email Address')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  return page;
}
