/**
 * TTS Web Worker Manager
 * Manages the TTS worker for non-blocking audio generation
 * 
 * This class handles:
 * 1. Worker lifecycle (creation, termination)
 * 2. Message passing to/from worker
 * 3. Promise-based API for synthesis
 * 4. Fallback detection when workers aren't supported
 */

// Worker message types
export interface TTSWorkerRequest {
  type: 'init' | 'synthesize' | 'cancel' | 'checkWebGPU';
  id?: string;
  text?: string;
  voice?: string;
  speed?: number;
}

export interface TTSWorkerResponse {
  type: 'ready' | 'progress' | 'audio' | 'error' | 'webgpu-status';
  id?: string;
  audioData?: ArrayBuffer;
  duration?: number;
  message?: string;
  percentage?: number;
  webgpuAvailable?: boolean;
}

export interface SynthesisResult {
  audioBlob: Blob;
  audioUrl: string;
  duration: number;
}

export type ProgressCallback = (message: string, percentage: number) => void;

class TTSWorkerManager {
  private worker: Worker | null = null;
  private isReady = false;
  private pendingRequests = new Map<string, {
    resolve: (result: SynthesisResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private progressCallbacks = new Map<string, ProgressCallback>();
  private initPromise: Promise<void> | null = null;
  private initialization: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    onProgress?: ProgressCallback;
  } | null = null;
  private webgpuAvailable: boolean | null = null;

  static isSupported(): boolean {
    try {
      // Check for Worker support
      if (typeof Worker === 'undefined') return false;
      
      // Check for SharedArrayBuffer (required for ONNX threading)
      if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('SharedArrayBuffer not available - COOP/COEP headers may be missing');
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;

    const worker = new Worker(
      new URL('./ttsWorkerScript.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<TTSWorkerResponse>) => {
      if (this.worker === worker) this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker === worker) {
        this.disposeWorker(new Error(event.message || 'Worker error'));
      }
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) {
        this.disposeWorker(new Error('Worker response could not be decoded'));
      }
    };

    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.worker === worker) {
          this.disposeWorker(new Error('Worker initialization timeout - model loading took too long. This may be due to slow network or large model size.'));
        }
      }, 120000);
      this.initialization = { resolve, reject, timer, onProgress };
    });
    this.initPromise = promise;
    try {
      worker.postMessage({ type: 'init' } as TTSWorkerRequest);
    } catch (error) {
      this.disposeWorker(this.asError(error));
    }
    return promise;
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private settleInitialization(error?: Error): void {
    const initialization = this.initialization;
    if (!initialization) return;
    this.initialization = null;
    this.initPromise = null;
    clearTimeout(initialization.timer);
    if (error) initialization.reject(error);
    else initialization.resolve();
  }

  private settleRequest(
    id: string,
    outcome: { result: SynthesisResult } | { error: Error },
  ): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;
    this.pendingRequests.delete(id);
    this.progressCallbacks.delete(id);
    clearTimeout(request.timer);
    if ('error' in outcome) request.reject(outcome.error);
    else request.resolve(outcome.result);
  }

  private rejectRequests(error: Error): void {
    for (const id of this.pendingRequests.keys()) {
      this.settleRequest(id, { error });
    }
  }

  private disposeWorker(error: Error): void {
    const worker = this.worker;
    // Invalidate identity before termination: queued callbacks cannot revive readiness.
    this.worker = null;
    this.isReady = false;
    this.settleInitialization(error);
    this.rejectRequests(error);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  private handleWorkerMessage(data: TTSWorkerResponse): void {
    const { type, id, audioData, duration, message, percentage, webgpuAvailable } = data;
    switch (type) {
      case 'ready':
        if (this.initialization) {
          this.isReady = true;
          this.settleInitialization();
        }
        break;
      case 'audio':
        if (id && this.pendingRequests.has(id)) {
          if (!(audioData instanceof ArrayBuffer) || audioData.byteLength === 0) {
            this.settleRequest(id, { error: new Error('Worker returned missing or empty audio data') });
            break;
          }
          try {
            const audioBlob = new Blob([audioData], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            this.settleRequest(id, {
              result: { audioBlob, audioUrl, duration: duration || 0 },
            });
          } catch (error) {
            this.settleRequest(id, { error: this.asError(error) });
          }
        }
        break;
      case 'error':
        if (id) this.settleRequest(id, { error: new Error(message || 'Synthesis failed') });
        else this.disposeWorker(new Error(message || 'Worker failed'));
        break;
      case 'progress':
        if (id) this.progressCallbacks.get(id)?.(message || '', percentage || 0);
        else this.initialization?.onProgress?.(message || '', percentage || 0);
        break;
      case 'webgpu-status':
        this.webgpuAvailable = webgpuAvailable || false;
        break;
    }
  }

  async synthesize(
    text: string,
    voice: string,
    speed: number = 1.0,
    onProgress?: ProgressCallback,
  ): Promise<SynthesisResult> {
    const worker = this.worker;
    if (!worker || !this.isReady) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }
    const id = `synth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.worker === worker && this.pendingRequests.has(id)) {
          // Terminate a stalled worker rather than queue retries behind stuck inference.
          this.disposeWorker(new Error('Worker synthesis timeout - audio generation exceeded 120 seconds. Please retry.'));
        }
      }, 120000);
      this.pendingRequests.set(id, { resolve, reject, timer });
      if (onProgress) this.progressCallbacks.set(id, onProgress);
      try {
        worker.postMessage({ type: 'synthesize', id, text, voice, speed } as TTSWorkerRequest);
      } catch (error) {
        this.disposeWorker(this.asError(error));
      }
    });
  }

  cancel(): void {
    // Preserve the initialized worker and the existing synthesis-only cancel contract.
    try {
      this.worker?.postMessage({ type: 'cancel' } as TTSWorkerRequest);
    } catch (error) {
      this.disposeWorker(this.asError(error));
    } finally {
      this.rejectRequests(new Error('Cancelled'));
    }
  }
  /**
   * Check if WebGPU is available
   */
  async checkWebGPU(): Promise<boolean> {
    if (this.webgpuAvailable !== null) {
      return this.webgpuAvailable;
    }

    // Check directly if worker not ready
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
        this.webgpuAvailable = adapter !== null;
        return this.webgpuAvailable;
      }
    } catch {
      // Ignore
    }
    
    this.webgpuAvailable = false;
    return false;
  }

  /**
   * Check if the worker is ready
   */
  isWorkerReady(): boolean {
    return this.isReady;
  }

  /** Terminate the worker and settle every operation owned by it. */
  terminate(): void {
    this.disposeWorker(new Error('Worker terminated'));
  }
}

// Singleton instance
let workerManager: TTSWorkerManager | null = null;

export function getTTSWorkerManager(): TTSWorkerManager {
  if (!workerManager) {
    workerManager = new TTSWorkerManager();
  }
  return workerManager;
}

export { TTSWorkerManager };
