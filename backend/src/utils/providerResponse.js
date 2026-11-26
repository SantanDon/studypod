const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;

export async function readProviderText(response, maxBytes, signal) {
  const reader = response.body?.getReader();
  if (!reader) {
    signal?.throwIfAborted();
    return "";
  }

  const cancel = (reason) => {
    // The underlying producer may take arbitrarily long to finish cancellation.
    void reader.cancel(reason).catch(() => {});
  };
  const cancelOnAbort = () => cancel(signal.reason);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    if (signal?.aborted) cancelOnAbort();
    signal?.throwIfAborted();

    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();

      // Fetch exposes the decoded body, regardless of the wire Content-Length.
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        const error = new RangeError("Provider response exceeded the response size limit.");
        cancel(error);
        throw error;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }
}

export async function readProviderJson(response, signal) {
  return JSON.parse(await readProviderText(response, MAX_PROVIDER_JSON_BYTES, signal));
}
