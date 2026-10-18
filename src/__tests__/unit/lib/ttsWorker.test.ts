import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSWorkerManager, type TTSWorkerRequest, type TTSWorkerResponse } from '@/lib/tts/ttsWorker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnInit = false;
  onmessage: ((event: MessageEvent<TTSWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: TTSWorkerRequest) => void>((request) => {
    if (request.type === 'init' && FakeWorker.throwOnInit) throw new Error('transport closed');
  });
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  emit(data: TTSWorkerResponse) { this.onmessage?.({ data } as MessageEvent<TTSWorkerResponse>); }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent); }
  latestId(): string {
    const request = this.postMessage.mock.calls.at(-1)?.[0];
    if (!request?.id) throw new Error('No synthesis request');
    return request.id;
  }
}

const NativeURL = URL;

describe('TTS worker operation settlement', () => {
  let manager: TTSWorkerManager;
  const createURL = vi.fn(() => 'blob:verified-result');
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    FakeWorker.throwOnInit = false;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('URL', class extends NativeURL {
      static createObjectURL = createURL;
    });
    createURL.mockClear();
    manager = new TTSWorkerManager();
  });
  afterEach(() => {
    manager.terminate();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const current = () => FakeWorker.instances.at(-1)!;
  async function ready() {
    const initialization = manager.initialize();
    current().emit({ type: 'ready' });
    await initialization;
  }

  it.each([undefined, new ArrayBuffer(0)])('rejects malformed audio and ignores later duplicate results', async (audioData) => {
    await ready();
    const pending = manager.synthesize('A sentence.', 'af_heart');
    const rejection = expect(pending).rejects.toThrow('missing or empty audio');
    const id = current().latestId();
    current().emit({ type: 'audio', id, audioData });
    await rejection;
    current().emit({ type: 'audio', id, audioData: new ArrayBuffer(8) });
    expect(createURL).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds silent synthesis, invalidates the stalled worker and permits fresh initialization', async () => {
    await ready();
    const worker = current();
    const pending = manager.synthesize('A sentence.', 'af_heart');
    const rejection = expect(pending).rejects.toThrow('synthesis timeout');
    await vi.advanceTimersByTimeAsync(120000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(manager.isWorkerReady()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await ready();
    expect(current()).not.toBe(worker);
  });

  it.each(['error', 'terminate', 'messageerror'] as const)('immediately settles initialization on %s', async (mode) => {
    const pending = manager.initialize();
    const rejection = expect(pending).rejects.toThrow();
    if (mode === 'error') current().fail('Initialization crashed');
    else if (mode === 'messageerror') current().onmessageerror?.();
    else manager.terminate();
    await rejection;
    expect(manager.isWorkerReady()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await ready();
  });

  it.each(['error', 'terminate'] as const)('settles all pending synthesis on %s', async (mode) => {
    await ready();
    const first = manager.synthesize('First.', 'af_heart');
    const second = manager.synthesize('Second.', 'af_heart');
    const assertions = [expect(first).rejects.toThrow(), expect(second).rejects.toThrow()];
    if (mode === 'error') current().fail('Worker crashed');
    else manager.terminate();
    await Promise.all(assertions);
    expect(manager.isWorkerReady()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out initialization and ignores queued ready/audio callbacks from the old worker', async () => {
    const pending = manager.initialize();
    const old = current();
    const queuedHandler = old.onmessage!;
    const rejection = expect(pending).rejects.toThrow('initialization timeout');
    await vi.advanceTimersByTimeAsync(120000);
    await rejection;
    const fresh = manager.initialize();
    queuedHandler({ data: { type: 'ready' } } as MessageEvent<TTSWorkerResponse>);
    expect(manager.isWorkerReady()).toBe(false);
    current().emit({ type: 'ready' });
    await fresh;
    const audio = manager.synthesize('Fresh.', 'af_heart');
    const id = current().latestId();
    queuedHandler({ data: { type: 'audio', id, audioData: new ArrayBuffer(8) } } as MessageEvent<TTSWorkerResponse>);
    expect(createURL).not.toHaveBeenCalled();
    current().emit({ type: 'audio', id, audioData: new ArrayBuffer(8), duration: 1 });
    await expect(audio).resolves.toMatchObject({ duration: 1, audioUrl: 'blob:verified-result' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels synthesis without discarding the ready worker or allowing cancelled progress', async () => {
    await ready();
    const progress = vi.fn();
    const pending = manager.synthesize('Cancel me.', 'af_heart', 1, progress);
    const id = current().latestId();
    const rejection = expect(pending).rejects.toThrow('Cancelled');
    manager.cancel();
    await rejection;
    current().emit({ type: 'progress', id, message: 'late', percentage: 50 });
    expect(progress).not.toHaveBeenCalled();
    expect(manager.isWorkerReady()).toBe(true);
    expect(current().terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up synchronous transport failures during init and synthesis', async () => {
    FakeWorker.throwOnInit = true;
    await expect(manager.initialize()).rejects.toThrow('transport closed');
    expect(vi.getTimerCount()).toBe(0);
    FakeWorker.throwOnInit = false;
    await ready();
    current().postMessage.mockImplementation(() => { throw new Error('transport closed'); });
    await expect(manager.synthesize('Sentence.', 'af_heart')).rejects.toThrow('transport closed');
    expect(manager.isWorkerReady()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
