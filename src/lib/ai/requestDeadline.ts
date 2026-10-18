export interface RequestDeadlineOptions {
  deadlineAt?: number;
  signal?: AbortSignal;
}

/** One absolute caller budget, retained through response-body consumption. */
export function createRequestDeadline(options: RequestDeadlineOptions = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.deadlineAt !== undefined) {
    if (!Number.isFinite(options.deadlineAt)) {
      options.signal?.removeEventListener('abort', abort);
      throw new Error('Invalid AI request deadline');
    }
    const remaining = options.deadlineAt - Date.now();
    const expire = () => controller.abort(new DOMException('AI request deadline expired', 'TimeoutError'));
    if (remaining <= 0) expire();
    else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
  }
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    },
  };
}
