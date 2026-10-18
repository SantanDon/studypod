// Opt-in browser assertions. No provider calls, signup, credentials or auto-run.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function openStudio(page, expect) {
  if ((page.viewportSize()?.width ?? 1440) >= 1100) return;
  const tab = page.getByRole('tab', { name: /(?:^|\s)Studio$/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function nativeState(audio) {
  return audio.evaluate(node => ({
    source: node.currentSrc || node.getAttribute('src'),
    duration: node.duration,
    currentTime: node.currentTime,
    readyState: node.readyState,
    paused: node.paused,
    playbackRate: node.playbackRate,
    errorCode: node.error?.code ?? null,
  }));
}

export async function verifyPodcastSpeed(player, expect) {
  const audio = player.locator('audio');
  const speed = player.getByRole('button', { name: /^\d+(?:\.\d+)?x$/ });
  await expect(speed).toHaveCount(1);
  await speed.click();
  await player.page().getByRole('menuitem', { name: '1.5x', exact: true }).click();
  await expect(speed).toHaveText('1.5x');
  await expect.poll(async () => (await nativeState(audio)).playbackRate, {
    message: 'Podcast 1.5x selection must change native playback rate',
  }).toBe(1.5);
  const selected = (await nativeState(audio)).playbackRate;
  await speed.click();
  await player.page().getByRole('menuitem', { name: '1x', exact: true }).click();
  await expect(speed).toHaveText('1x');
  await expect.poll(async () => (await nativeState(audio)).playbackRate, {
    message: 'Podcast 1x selection must restore native playback rate',
  }).toBe(1);
  return { selected, restored: (await nativeState(audio)).playbackRate };
}

export async function verifyPlayback(player, expect) {
  const audio = player.locator('audio');
  await expect(audio).toHaveCount(1);
  await expect.poll(async () => {
    const state = await nativeState(audio);
    return Number.isFinite(state.duration) && state.duration > 3
      && state.readyState >= 2 && state.errorCode === null;
  }, { timeout: 30_000, message: 'Real media must decode before playback' }).toBe(true);
  const pause = player.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  const before = await nativeState(audio);
  // A selected saved episode may restore a checkpoint near its end.
  // The caller should choose an earlier checkpoint before invoking this helper.
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => {
    const state = await nativeState(audio);
    return !state.paused && state.currentTime > before.currentTime + 0.2;
  }, { timeout: 15_000, message: 'UI Play must advance native media time' }).toBe(true);
  await pause.click();
  await expect.poll(async () => (await nativeState(audio)).paused).toBe(true);
  const slider = player.getByRole('slider', { name: /playback position|Chapter position/ });
  await slider.focus();
  await slider.press('Home');
  for (let i = 0; i < 4; i += 1) await slider.press('ArrowRight');
  await expect.poll(async () => (await nativeState(audio)).currentTime, {
    message: 'Visible slider must seek native media',
  }).toBeGreaterThanOrEqual(1.5);
  const podcastSpeed = await player.evaluate(node => node.classList.contains('podcast-player-container'))
    ? await verifyPodcastSpeed(player, expect) : undefined;
  return { before, after: await nativeState(audio), ...(podcastSpeed ? { podcastSpeed } : {}) };
}

export async function downloadPodcast(page, player, outputPath, expectedSha256, expect) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('Expected persisted media SHA-256 required');
  const downloadEvent = page.waitForEvent('download');
  await player.getByRole('button', { name: / audio options$/ }).click();
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  await download.saveAs(outputPath);
  const bytes = await readFile(outputPath);
  expect(bytes.byteLength).toBeGreaterThan(1000);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(sha256).toBe(expectedSha256.toLowerCase());
  return { outputPath, byteLength: bytes.byteLength, sha256 };
}

export async function waitForSelectedHistoryMedia(audio, previousSource, expect) {
  await expect.poll(async () => {
    const state = await nativeState(audio);
    return !!state.source && state.source !== previousSource && state.paused
      && Number.isFinite(state.duration) && state.duration > 3
      && state.readyState >= 2 && state.errorCode === null;
  }, { timeout: 30_000, message: 'History selection must load its new media before Play' }).toBe(true);
  // For multiple episodes additionally compare the loaded bytes to the selected
  // persisted episode SHA-256. Source change alone is not content identity proof.
  return nativeState(audio);
}
