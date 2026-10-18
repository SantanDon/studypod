// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractUploadedBook } from "../services/audiobookUploadService.js";
import {
  buildBookResponse,
  extractBookFromFile,
  loadBookManifest,
  saveBookManifest,
} from "../services/audiobookBookService.js";

const temporaryRoots = [];
function upload(originalname = "source.txt") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-source-upload-"));
  temporaryRoots.push(root);
  const uploadsDir = path.join(root, "uploads");
  const tempDir = path.join(uploadsDir, "temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const file = { originalname, path: path.join(tempDir, "upload.tmp") };
  fs.writeFileSync(file.path, "A temporary source with meaningful study content.");
  return { root, uploadsDir, file, ownerId: "qa-owner" };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("uploaded book persistence", () => {
  it("extracts a real EPUB as a source without creating a book asset or manifest", async () => {
    const input = upload("chapter.epub");
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/epub+zip"));
    zip.addFile("META-INF/container.xml", Buffer.from('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
    zip.addFile("book.opf", Buffer.from('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">qa-book</dc:identifier><dc:title>Source Only Book</dc:title><dc:creator>QA Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'));
    zip.addFile("chapter.xhtml", Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Study chapter</title></head><body><h1>Study chapter</h1><p>Photosynthesis transforms light into chemical energy for plants.</p></body></html>'));
    zip.writeZip(input.file.path);
    const persistBook = vi.fn();

    const result = await extractUploadedBook({ ...input, persistOption: "false", persistBook });

    expect(result.content).toContain("Photosynthesis transforms light");
    expect(result.title).toBe("Source Only Book");
    expect(result.author).toBe("QA Author");
    expect(result.chapters).toHaveLength(1);
    expect(result.stats.charCount).toBeGreaterThan(20);
    expect(result).not.toHaveProperty("manifest");
    expect(JSON.stringify(result)).not.toContain(input.root);
    expect(persistBook).not.toHaveBeenCalled();
    expect(fs.existsSync(input.file.path)).toBe(false);
    expect(fs.readdirSync(input.uploadsDir)).toEqual(["temp"]);
    expect(fs.readdirSync(path.dirname(input.file.path))).toEqual([]);
  });

  it("removes a nonpersistent upload when parsing fails", async () => {
    const input = upload("broken.epub");
    const persistBook = vi.fn();
    await expect(extractUploadedBook({ ...input, persistOption: "false", persistBook }))
      .rejects.toThrow();
    expect(persistBook).not.toHaveBeenCalled();
    expect(fs.existsSync(input.file.path)).toBe(false);
    expect(fs.readdirSync(input.uploadsDir)).toEqual(["temp"]);
  });

  it("cleans up an empty extraction rather than returning an unusable source", async () => {
    const input = upload();
    fs.writeFileSync(input.file.path, "");
    await expect(extractUploadedBook({ ...input, persistOption: "false", persistBook: vi.fn() }))
      .rejects.toThrow("no extractable text");
    expect(fs.existsSync(input.file.path)).toBe(false);
  });

  it.each(["", "FALSE", "0", ["false", "true"], { value: "false" }])(
    "rejects malformed persistence option %j before persisting and removes the upload",
    async (persistOption) => {
      const input = upload();
      const persistBook = vi.fn();
      const extractBook = vi.fn();
      await expect(extractUploadedBook({ ...input, persistOption, persistBook, extractBook }))
        .rejects.toMatchObject({ status: 400, message: "persist must be true or false" });
      expect(persistBook).not.toHaveBeenCalled();
      expect(extractBook).not.toHaveBeenCalled();
      expect(fs.existsSync(input.file.path)).toBe(false);
      expect(fs.readdirSync(input.uploadsDir)).toEqual(["temp"]);
    },
  );

  it.each([undefined, "true"])("preserves durable audiobook behavior for persist=%s", async (persistOption) => {
    const input = upload();
    const manifestDir = path.join(input.uploadsDir, "audiobook_manifests");
    const persistBook = vi.fn(async ({ permanentPath, fileName, source, ownerId }) => {
      const extraction = await extractBookFromFile(permanentPath, fileName);
      const book = buildBookResponse({ permanentPath, fileName, source, extraction });
      book.manifest.ownerId = ownerId;
      saveBookManifest(manifestDir, book.manifest);
      return book;
    });
    const result = await extractUploadedBook({ ...input, persistOption, persistBook });
    const persisted = persistBook.mock.calls[0][0];
    expect(fs.existsSync(persisted.permanentPath)).toBe(true);
    expect(loadBookManifest(manifestDir, result.fileName).ownerId).toBe(input.ownerId);
    expect(fs.existsSync(input.file.path)).toBe(false);
    expect(persisted.source).toBe("upload");
  });

  it("removes both temporary and permanent files if durable extraction fails", async () => {
    const input = upload();
    const persistBook = vi.fn(async () => { throw new Error("parse failed"); });
    await expect(extractUploadedBook({ ...input, persistBook })).rejects.toThrow("parse failed");
    expect(fs.existsSync(input.file.path)).toBe(false);
    expect(fs.existsSync(persistBook.mock.calls[0][0].permanentPath)).toBe(false);
  });
});
