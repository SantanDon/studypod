import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBookManifest, saveBookManifest, saveBookManifestAsync } from "../services/audiobookBookService.js";

let directory;
let destination;
let originalBytes;
const manifest = { fileName: "publication.txt", title: "Original", chapters: [] };

function ioError(code) {
  return Object.assign(new Error(`Synthetic ${code} rename failure`), { code });
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-publication-"));
  destination = saveBookManifest(directory, manifest);
  originalBytes = fs.readFileSync(destination);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("atomic audiobook manifest publication", () => {
  it("yields to other event-loop work while waiting for a transient reader lock", async () => {
    const rename = fs.promises.rename.bind(fs.promises);
    let heartbeat = false;
    let attempts = 0;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (source, target) => {
      attempts += 1;
      if (attempts === 1) {
        setTimeout(() => { heartbeat = true; }, 0);
        throw ioError("EPERM");
      }
      expect(heartbeat).toBe(true);
      await rename(source, target);
    });
    await saveBookManifestAsync(directory, { ...manifest, title: "Replacement" });
    expect(attempts).toBe(2);
    expect(loadBookManifest(directory, manifest.fileName).title).toBe("Replacement");
  });
  it.each(["EPERM", "EACCES", "EBUSY"])("retries transient %s without deleting the previous manifest", async (code) => {
    const rename = fs.promises.rename.bind(fs.promises);
    const sources = [];
    const wait = vi.spyOn(globalThis, "setTimeout");
    const mockedRename = vi.spyOn(fs.promises, "rename").mockImplementation(async (source, target) => {
      sources.push(source);
      expect(target).toBe(destination);
      expect(fs.readFileSync(destination)).toEqual(originalBytes);
      expect(JSON.parse(fs.readFileSync(source, "utf8")).title).toBe("Replacement");
      if (sources.length < 3) throw ioError(code);
      await rename(source, target);
    });

    expect(await saveBookManifestAsync(directory, { ...manifest, title: "Replacement" })).toBe(destination);
    expect(mockedRename).toHaveBeenCalledTimes(3);
    expect(new Set(sources).size).toBe(1);
    expect(wait.mock.calls.map((call) => call[1])).toEqual([20, 40]);
    expect(loadBookManifest(directory, manifest.fileName).title).toBe("Replacement");
    expect(fs.readdirSync(directory)).toEqual([path.basename(destination)]);
  });

  it("bounds permanent contention and surfaces the original error with saved bytes intact", async () => {
    const error = ioError("EPERM");
    const rename = vi.spyOn(fs.promises, "rename").mockImplementation(() => { throw error; });
    const wait = vi.spyOn(globalThis, "setTimeout");
    await expect(saveBookManifestAsync(directory, { ...manifest, title: "Unsaved" })).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map((call) => call[1])).toEqual([20, 40, 80, 160]);
    expect(fs.readFileSync(destination)).toEqual(originalBytes);
    expect(fs.readdirSync(directory)).toEqual([path.basename(destination)]);
  });

  it("does not retry unrelated rename failures", async () => {
    const error = ioError("ENOSPC");
    const rename = vi.spyOn(fs.promises, "rename").mockImplementation(() => { throw error; });
    const wait = vi.spyOn(globalThis, "setTimeout");
    await expect(saveBookManifestAsync(directory, manifest)).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(fs.readFileSync(destination)).toEqual(originalBytes);
    expect(fs.readdirSync(directory)).toEqual([path.basename(destination)]);
  });

  it("does not retry write faults or attempt publication", async () => {
    const error = ioError("EPERM");
    vi.spyOn(fs.promises, "writeFile").mockImplementation(() => { throw error; });
    const rename = vi.spyOn(fs.promises, "rename");
    const wait = vi.spyOn(globalThis, "setTimeout");
    await expect(saveBookManifestAsync(directory, manifest)).rejects.toBe(error);
    expect(rename).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(fs.readFileSync(destination)).toEqual(originalBytes);
  });
});

