import { test, expect } from '@playwright/test';
import { checkLayout, checkProfileKeyboard, observeBrowser } from './helpers';

test('deployed guest entry and real read-only capabilities', async ({ page, request }, testInfo) => {
  const baseURL = process.env.STUDYPOD_BASE_URL;
  expect(baseURL, 'Set STUDYPOD_BASE_URL to the exact deployed URL').toBeTruthy();
  expect(new URL(baseURL!).protocol, 'Deployment smoke requires HTTPS').toBe('https:');
  const verify = await observeBrowser(page, testInfo, false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create notebook', exact: true })).toBeVisible();
  await checkProfileKeyboard(page);
  await checkLayout(page);
  await page.screenshot({ path: testInfo.outputPath('deployed-dashboard.png'), fullPage: true });
  const health = await request.get('/api/health');
  expect.soft(health.ok(), `Deployed health endpoint returned ${health.status()}`).toBe(true);
  await expect.poll(() => page.evaluate(() => /^guest_[A-Za-z0-9_-]{12,128}$/.test(localStorage.getItem('guest_id') || '')), 'Fresh guest identity initialized').toBe(true);
  const guestId = await page.evaluate(() => localStorage.getItem('guest_id'));
  const voices = await request.get('/api/audiobook/voices', { headers: { Authorization: `Bearer ${guestId}` } });
  expect.soft(voices.ok(), `Real deployed audiobook capability endpoint returned ${voices.status()}`).toBe(true);
  const payload = voices.ok() ? await voices.json() : null;
  if (payload) {
    const expectedEnabled = process.env.STUDYPOD_EXPECT_AUDIOBOOK_ENABLED === 'true';
    expect.soft(payload.capabilities?.enabled, 'Runtime capability must match the release claim').toBe(expectedEnabled);
    expect.soft(payload.capabilities?.fullGeneration).toBe(expectedEnabled);
  }
  await testInfo.attach('deployed-capabilities', { body: JSON.stringify({ url: baseURL, healthStatus: health.status(), voicesStatus: voices.status(), capabilities: payload?.capabilities }, null, 2), contentType: 'application/json' });
  await verify();
});
