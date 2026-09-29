import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadBookManifest,
  manifestPathFor,
  saveBookManifest,
} from "../services/audiobookBookService.js";

const tempPaths = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-manifest-durable-"));
  tempPaths.push(dir);
  return dir;
};

const leftovers = (dir) =>
  fs
    .readdirSync(dir)
    .filter((entry) => entry.includes(".tmp") || entry.includes(".bak"));

const baseManifest = (title) => ({
  schemaVersion: 2,
  ownerId: "guest_durability_test",
  fileName: "durable-book.pdf",
  title,
  author: "Test Author",
  chapters: [],
  renders: {},
  activeRenderId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const target of tempPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("saveBookManifest durability (synthetic)", () => {
  it("performs a successful initial save and replacement", () => {
    const dir = tempDir();
    const manifestPath = manifestPathFor(dir, "durable-book.pdf");
    saveBookManifest(dir, baseManifest("Durable v1"));
    const beforeBytes = fs.readFileSync(manifestPath, "utf8");
    expect(loadBookManifest(dir, "durable-book.pdf").title).toBe("Durable v1");

    saveBookManifest(dir, baseManifest("Durable v2"));
    expect(loadBookManifest(dir, "durable-book.pdf").title).toBe("Durable v2");
    expect(fs.readFileSync(manifestPath, "utf8")).not.toBe(beforeBytes);
    expect(leftovers(dir)).toEqual([]);
  });

  it.each(["EPERM", "EACCES", "EEXIST"])(
    "blocked rename (%s) preserves byte-identical old data without copying",
    (code) => {
      const dir = tempDir();
      const manifestPath = manifestPathFor(dir, "durable-book.pdf");
      saveBookManifest(dir, baseManifest("Durable v1"));
      const beforeBytes = fs.readFileSync(manifestPath, "utf8");
      const copySpy = vi.spyOn(fs, "copyFileSync");
      vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw Object.assign(new Error(`blocked: ${code}`), { code });
      });

      let caught = null;
      try {
        saveBookManifest(dir, baseManifest("Durable v2"));
      } catch (error) {
        caught = error;
      }
      expect(caught?.code).toBe(code);
      expect(fs.readFileSync(manifestPath, "utf8")).toBe(beforeBytes);
      expect(loadBookManifest(dir, "durable-book.pdf").title).toBe(
        "Durable v1",
      );
      expect(copySpy).not.toHaveBeenCalled();
      expect(leftovers(dir)).toEqual([]);
    },
  );

  it("cleans up the temporary file on an unexpected rename failure", () => {
    const dir = tempDir();
    const manifestPath = manifestPathFor(dir, "durable-book.pdf");
    saveBookManifest(dir, baseManifest("Durable v1"));
    const beforeBytes = fs.readFileSync(manifestPath, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    let caught = null;
    try {
      saveBookManifest(dir, baseManifest("Durable v2"));
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe("EXDEV");
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(beforeBytes);
    expect(leftovers(dir)).toEqual([]);
  });

  it("partial initial write fault cleans the temp file and retains the old file", () => {
    const dir = tempDir();
    const manifestPath = manifestPathFor(dir, "durable-book.pdf");
    saveBookManifest(dir, baseManifest("Durable v1"));
    const beforeBytes = fs.readFileSync(manifestPath, "utf8");
    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, ...rest) => {
      void rest;
      realWrite(target, "{truncated", "utf8");
      throw Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      });
    });

    let caught = null;
    try {
      saveBookManifest(dir, baseManifest("Durable v2"));
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe("ENOSPC");
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(beforeBytes);
    expect(loadBookManifest(dir, "durable-book.pdf").title).toBe("Durable v1");
    expect(leftovers(dir)).toEqual([]);
  });

  it("serialization failure keeps the old file intact", () => {
    const dir = tempDir();
    const manifestPath = manifestPathFor(dir, "durable-book.pdf");
    saveBookManifest(dir, baseManifest("Durable v1"));
    const beforeBytes = fs.readFileSync(manifestPath, "utf8");
    const circular = baseManifest("Durable v2");
    circular.self = circular;

    expect(() => saveBookManifest(dir, circular)).toThrow(TypeError);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(beforeBytes);
    expect(loadBookManifest(dir, "durable-book.pdf").title).toBe("Durable v1");
    expect(leftovers(dir)).toEqual([]);
  });

  it("blocked rename with no existing destination invents no valid manifest", () => {
    const dir = tempDir();
    const manifestPath = manifestPathFor(dir, "durable-book.pdf");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("blocked: EPERM"), { code: "EPERM" });
    });

    let caught = null;
    try {
      saveBookManifest(dir, baseManifest("Durable v1"));
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe("EPERM");
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(loadBookManifest(dir, "durable-book.pdf")).toBeNull();
    expect(leftovers(dir)).toEqual([]);
  });

  it("rejects missing manifests and directories with a TypeError", () => {
    const dir = tempDir();
    expect(() => saveBookManifest(dir, null)).toThrow(TypeError);
    expect(() => saveBookManifest(dir, { title: "no file" })).toThrow(TypeError);
    expect(() => saveBookManifest("", baseManifest("x"))).toThrow(TypeError);
    expect(leftovers(dir)).toEqual([]);
  });
});
