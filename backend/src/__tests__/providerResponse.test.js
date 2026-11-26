// @vitest-environment node
import { once } from "node:events";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { readProviderJson, readProviderText } from "../utils/providerResponse.js";

it("decodes JSON across splits in a multibyte character", async () => {
  const bytes = new TextEncoder().encode('{"value":"📕"}');
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 12));
      controller.enqueue(bytes.slice(12));
      controller.close();
    },
  }));
  await expect(readProviderJson(response)).resolves.toEqual({ value: "📕" });
  expect(response.body.locked).toBe(false);
});

it("rejects decoded bytes beyond the limit despite a smaller compressed Content-Length", async () => {
  const body = gzipSync(JSON.stringify({ value: "é".repeat(1_050_000) }));
  expect(body.byteLength).toBeLessThan(2 * 1024 * 1024);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip", "content-length": body.byteLength });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const response = await fetch(`http://127.0.0.1:${server.address().port}`);
    await expect(readProviderJson(response)).rejects.toThrow(RangeError);
    expect(response.body.locked).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

it("cancels on overflow even when the underlying cancellation never settles", async () => {
  const cancel = vi.fn(() => new Promise(() => {}));
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2));
      controller.enqueue(new Uint8Array(2));
    },
    cancel,
  }));
  await expect(readProviderText(response, 3)).rejects.toThrow(RangeError);
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body.locked).toBe(false);
});

it("cancels a pending read promptly and preserves the abort reason", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const controller = new AbortController();
  const reason = new Error("Request ended");
  const reading = readProviderJson(response, controller.signal);
  controller.abort(reason);
  await expect(reading).rejects.toBe(reason);
  expect(cancel).toHaveBeenCalledWith(reason);
  expect(response.body.locked).toBe(false);
});
