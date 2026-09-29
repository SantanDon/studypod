import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real worker wrapper, but never import a database or speech engine.
const mocks = vi.hoisted(() => ({ postMessage: vi.fn(), generate: vi.fn() }));
vi.mock('worker_threads', () => {
  const worker = {
    parentPort: { postMessage: mocks.postMessage },
    workerData: { jobId: 'worker-contract-fixture' },
  };
  // The installed Vite Node transform also consults the CJS default export.
  return { ...worker, default: worker };
});
vi.mock('../routes/audiobook.js', () => ({ runFullAudiobookJob: mocks.generate }));
let savedExitCode;
beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.resetModules();
  mocks.postMessage.mockReset();
  mocks.generate.mockReset();
});
afterEach(() => { process.exitCode = savedExitCode; });
const runWrapper = () => import('../workers/audiobookGenerationWorker.js');

describe('audiobook worker result contract', () => {
  it('preserves the existing completed message and successful exit behavior', async () => {
    mocks.generate.mockResolvedValue({ status: 'completed', fileName: 'fixture.mp3' });
    await runWrapper();
    expect(mocks.generate).toHaveBeenCalledWith({ jobId: 'worker-contract-fixture' });
    expect(mocks.postMessage).toHaveBeenCalledExactlyOnceWith({ status: 'completed', jobId: 'worker-contract-fixture', fileName: 'fixture.mp3' });
    expect(process.exitCode).toBeUndefined();
  });

  it.each([new Error('fixture rejection'), 'fixture rejection'])('preserves rejected errors and non-error throw values', async (error) => {
    mocks.generate.mockRejectedValue(error);
    await runWrapper();
    expect(mocks.postMessage).toHaveBeenCalledExactlyOnceWith({ status: 'failed', jobId: 'worker-contract-fixture', error: 'fixture rejection' });
    expect(process.exitCode).toBe(1);
  });

  // These are defensive cases: the current normal failure path throws rather
  // than resolving to these values. Do not report them as a reproduced outage.
  it.each(['failed', 'paused', 'processing', 'cancelled'])('rejects an unexpected fulfilled %s state', async (status) => {
    mocks.generate.mockResolvedValue({ status });
    await runWrapper();
    expect(mocks.postMessage).toHaveBeenCalledOnce();
    expect(mocks.postMessage.mock.calls[0][0]).toMatchObject({ status: 'failed', jobId: 'worker-contract-fixture' });
    expect(mocks.postMessage.mock.calls[0][0].error).toContain(status);
    expect(process.exitCode).toBe(1);
  });

  it.each([null, undefined, {}, 0, 'unexpected'])('does not invent completion for an absent or malformed result: %s', async (result) => {
    mocks.generate.mockResolvedValue(result);
    await runWrapper();
    expect(mocks.postMessage).toHaveBeenCalledOnce();
    expect(mocks.postMessage.mock.calls[0][0]).toMatchObject({ status: 'failed', jobId: 'worker-contract-fixture' });
    expect(process.exitCode).toBe(1);
  });

  it('preserves a useful error on an unexpected fulfilled failure', async () => {
    mocks.generate.mockResolvedValue({ status: 'failed', error: 'fixture encoder failure' });
    await runWrapper();
    expect(mocks.postMessage.mock.calls[0][0].error).toBe('fixture encoder failure');
    expect(process.exitCode).toBe(1);
  });

  it('does not produce an empty error when the result contains whitespace only', async () => {
    mocks.generate.mockResolvedValue({ status: 'failed', error: '   ' });
    await runWrapper();
    expect(mocks.postMessage.mock.calls[0][0].error).toContain('did not complete');
    expect(process.exitCode).toBe(1);
  });
});
