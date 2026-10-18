/** One hosted chat budget shared by initial generation, critique and repairs. */
export function createChatRequestBudget({ req, res, timeoutMs, hosted = process.env.VERCEL === "1", clock = {} } = {}) {
  const now = clock.now ?? Date.now;
  const schedule = clock.setTimeout ?? setTimeout;
  const cancelTimer = clock.clearTimeout ?? clearTimeout;
  const duration = timeoutMs === undefined ? (hosted ? 50_000 : Infinity)
    : Math.min(50_000, Math.max(0, timeoutMs));
  const deadline = now() + duration;
  const controller = new AbortController();
  const failure = (code, message) => Object.assign(new Error(message), { code });
  const abort = (reason) => { if (!controller.signal.aborted) controller.abort(reason); };
  const expire = () => abort(failure("CHAT_TIMEOUT", "The answer took too long to verify."));
  const disconnect = () => abort(failure("CHAT_REQUEST_CANCELLED", "The chat request was cancelled."));
  const close = () => { if (!res?.writableFinished) disconnect(); };
  let timer = Number.isFinite(duration) ? schedule(expire, duration) : null;
  req?.on?.("aborted", disconnect);
  res?.on?.("close", close);
  if (req?.aborted || res?.destroyed) disconnect();
  const remainingMs = () => {
    if (now() >= deadline) expire();
    controller.signal.throwIfAborted();
    return Math.max(0, deadline - now());
  };
  return {
    signal: controller.signal,
    remainingMs,
    async run(task) {
      remainingMs();
      let onAbort;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => { remainingMs(); return task(); }), cancelled,
        ]);
      } finally { controller.signal.removeEventListener("abort", onAbort); }
    },
    dispose() {
      if (timer !== null) { cancelTimer(timer); timer = null; }
      req?.off?.("aborted", disconnect);
      res?.off?.("close", close);
    },
  };
}
