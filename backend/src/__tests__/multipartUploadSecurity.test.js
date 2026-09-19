import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import multer from "multer";
import { errorHandler } from "../middleware/errorHandler.js";
import { singleFileUploadLimits } from "../middleware/uploadSecurity.js";

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  const fileOnlyUpload = multer({
    storage: multer.memoryStorage(),
    limits: singleFileUploadLimits(16),
  });
  const agentStyleUpload = multer({
    storage: multer.memoryStorage(),
    limits: singleFileUploadLimits(32, { fields: 1 }),
  });

  app.post("/file-only", fileOnlyUpload.single("file"), (req, res) => {
    res.json({ size: req.file?.size ?? 0 });
  });
  app.post("/agent-style", agentStyleUpload.single("file"), (req, res) => {
    res.json({ notebookId: req.body.notebookId, size: req.file?.size ?? 0 });
  });
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function multipartPayload(contents = "ok", fields = {}) {
  const boundary = "----studypod-multipart-test";
  const segments = [];

  for (const [name, value] of Object.entries(fields)) {
    segments.push(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="${name}"\r\n\r\n`
      + `${value}\r\n`,
    );
  }

  segments.push(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="file"; filename="note.txt"\r\n'
    + "Content-Type: text/plain\r\n\r\n"
    + contents
    + "\r\n"
    + `--${boundary}--\r\n`,
  );

  return {
    boundary,
    body: Buffer.from(segments.join(""), "utf8"),
  };
}

async function post(path, { contents = "ok", fields = {} } = {}) {
  const { boundary, body } = multipartPayload(contents, fields);

  return await new Promise((resolve, reject) => {
    const request = http.request(
      new URL(`${baseUrl}${path}`),
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Connection: "close",
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(raw),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);
    request.end(body);
  });
}

describe("multipart upload security", () => {
  it("preserves a valid single-file upload with the one allowed text field", async () => {
    const response = await post("/agent-style", {
      contents: "hello",
      fields: { notebookId: "nb-1" },
    });

    expect(response).toEqual({
      status: 200,
      body: { notebookId: "nb-1", size: 5 },
    });
  });

  it("rejects oversized files as a client error instead of a server failure", async () => {
    const response = await post("/file-only", {
      contents: "x".repeat(17),
    });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: "LIMIT_FILE_SIZE" });
  });

  it("rejects deeply nested multipart field names", async () => {
    const response = await post("/agent-style", {
      contents: "ok",
      fields: { "notebook[id][extra]": "nested" },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toMatch(/^LIMIT_/);
  });

  it("continues accepting valid uploads after rejected requests", async () => {
    const response = await post("/file-only", {
      contents: "recovered",
    });

    expect(response).toEqual({ status: 200, body: { size: 9 } });
  });
});
