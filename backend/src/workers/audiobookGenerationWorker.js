import { parentPort, workerData } from 'worker_threads';
import { runFullAudiobookJob } from '../routes/audiobook.js';

try {
  const job = await runFullAudiobookJob(workerData);
  // Owner cancellation is a distinct terminal state: acknowledge it without
  // a failure exit so the parent keeps the persisted cancellation instead of
  // pausing the render as failed.
  if (job?.status === 'cancelled') {
    parentPort?.postMessage({
      status: 'cancelled',
      jobId: workerData.jobId,
    });
  } else if (job?.status !== 'completed') {
    // The normal failure path already throws. Fail closed on an unexpected
    // fulfilled result instead of reporting completion after a future refactor.
    const status = typeof job?.status === 'string' ? job.status : 'unknown';
    const message = typeof job?.error === 'string' && job.error.trim()
      ? job.error
      : `Audiobook job did not complete (status: ${status})`;
    throw new Error(message);
  } else {
    parentPort?.postMessage({
      status: 'completed',
      jobId: workerData.jobId,
      fileName: job?.fileName,
    });
  }
} catch (error) {
  // A cancellation thrown at a bounded checkpoint is also acknowledged as
  // cancelled so late completion is never published.
  if (error?.code === 'AUDIOBOOK_JOB_CANCELLED') {
    parentPort?.postMessage({
      status: 'cancelled',
      jobId: workerData.jobId,
    });
  } else {
    parentPort?.postMessage({
      status: 'failed',
      jobId: workerData.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
