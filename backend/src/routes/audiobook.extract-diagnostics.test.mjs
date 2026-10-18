import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../utils/logger.js";

test("extract failure reports safe error categories without upload content or paths", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-extract-diagnostic-"));
  const previousStorage = process.env.AUDIOBOOK_STORAGE_DIR;
  const previousVercel = process.env.VERCEL;
  const originalCopy = fs.copyFileSync;
  const originalLog = logger.error;
  process.env.AUDIOBOOK_STORAGE_DIR = scratch;
  process.env.VERCEL = "";
  try {
    const { default: router } = await import("./audiobook.js");
    const route = router.stack.find((layer) => layer.route?.path === "/extract");
    const handler = route.route.stack.at(-1).handle;
    const cases = [
      { name: "Error", code: "EPERM", expected: { name: "Error", code: "EPERM" } },
      { name: "ReferenceError", code: undefined, expected: { name: "ReferenceError", code: "UNCLASSIFIED" } },
      { name: "private-book-text", code: "private-upload-path", expected: { name: "Error", code: "UNCLASSIFIED" } },
    ];
    for (const fixture of cases) {
      const failure = Object.assign(new Error("private-upload-path private-book-text"), {
        name: fixture.name,
        code: fixture.code,
      });
      fs.copyFileSync = () => { throw failure; };
      let logged;
      logger.error = (...args) => { logged = args; };
      let status = 200;
      let body;
      await handler(
        { file: { path: path.join(scratch, "not-created"), originalname: "private-book-text.epub" }, query: {}, user: { userId: "synthetic-owner" } },
        { status(value) { status = value; return this; }, json(value) { body = value; return this; } },
      );
      assert.equal(status, 500);
      assert.deepEqual(body, { error: "Book extraction failed" });
      assert.deepEqual(logged, ["Book extraction failed:", fixture.expected]);
      assert.doesNotMatch(JSON.stringify(logged), /private-upload-path|private-book-text/);
    }
  } finally {
    fs.copyFileSync = originalCopy;
    logger.error = originalLog;
    if (previousStorage === undefined) delete process.env.AUDIOBOOK_STORAGE_DIR;
    else process.env.AUDIOBOOK_STORAGE_DIR = previousStorage;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
