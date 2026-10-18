/** Acceptance budget for real browser Kokoro, never a playback-success oracle.
 * Frozen replay measured 85.8s cold init and 9.6–19.7s per completed segment.
 * Reserve 120s initialization plus 30s per script segment, bounded at six minutes.
 * Worker request deadlines remain independent; a stalled request must still fail.
 */
export function podcastGenerationBudget(segmentCount: number) {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 1) {
    throw new Error('A real nonempty podcast script is required for the generation budget');
  }
  const initializationAllowanceMs = 120_000;
  const segmentAllowanceMs = 30_000;
  const maximumMs = 360_000;
  return {
    expectedSegments: segmentCount,
    initializationAllowanceMs,
    segmentAllowanceMs,
    maximumMs,
    timeoutMs: Math.min(maximumMs, initializationAllowanceMs + segmentCount * segmentAllowanceMs),
  };
}
