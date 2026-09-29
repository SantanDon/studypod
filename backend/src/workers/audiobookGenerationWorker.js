import { parentPort, workerData } from 'worker_threads';
import { runFullAudiobookJob } from '../routes/audiobook.js';

try {
  const job = await runFullAudiobookJob(workerData);
  // The normal failure path already throws. Fail closed on an unexpected
  // fulfilled result instead of reporting completion after a future refactor.
  if (job?.status !== 'completed') {
    const status = typeof job?.status === 'string' ? job.status : 'unknown';
    const message = typeof job?.error === 'string' && job.error.trim()
      ? job.error
      : `Audiobook job did not complete (status: ${status})`;
    throw new Error(message);
  }
  parentPort?.postMessage({
    status: 'completed',
    jobId: workerData.jobId,
    fileName: job?.fileName,
  });
} catch (error) {
  parentPort?.postMessage({
    status: 'failed',
    jobId: workerData.jobId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
