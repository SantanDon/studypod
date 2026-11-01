const MAX_RENDER_CONCURRENCY = 4;

export function createAudiobookRenderAdmission(limit = 1) {
  const capacity = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_RENDER_CONCURRENCY)
    : 1;
  const reservations = new Set();

  return {
    tryAcquire(jobId) {
      if (typeof jobId !== "string" || !jobId || reservations.has(jobId)) {
        return false;
      }
      if (reservations.size >= capacity) return false;
      reservations.add(jobId);
      return true;
    },
    release(jobId) {
      return reservations.delete(jobId);
    },
    get activeCount() {
      return reservations.size;
    },
  };
}

export async function awaitAudiobookSpeechWithCancellation(check, speechWork) {
  check();
  const result = await speechWork();
  check();
  return result;
}

const configuredLimit = Number.parseInt(
  process.env.AUDIOBOOK_MAX_CONCURRENT_RENDERS || "1",
  10,
);

export const audiobookRenderAdmission = createAudiobookRenderAdmission(
  configuredLimit,
);
