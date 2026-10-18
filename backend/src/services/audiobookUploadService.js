import fs from "fs";
import path from "path";
import {
  buildBookResponse,
  extractBookFromFile,
  sanitizeFileName,
  uniqueSafeFileName,
} from "./audiobookBookService.js";

export function parseBookPersistenceOption(value) {
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  const error = new Error("persist must be true or false");
  error.status = 400;
  throw error;
}

// Source uploads need the extracted text, without creating an audiobook asset.
// Keep the durable audiobook path as the default for existing callers.
export async function extractUploadedBook({
  file,
  persistOption,
  uploadsDir,
  ownerId,
  persistBook,
  extractBook = extractBookFromFile,
}) {
  let permanentPath;
  try {
    if (!parseBookPersistenceOption(persistOption)) {
      const fileName = sanitizeFileName(file.originalname);
      const extraction = await extractBook(file.path, fileName);
      const book = buildBookResponse({
        fileName,
        permanentPath: null,
        extraction,
        source: "upload",
      });
      if (!book.content || book.content.length < 2) {
        throw new Error("Book contains no extractable text");
      }
      const { manifest: _privateManifest, ...publicBook } = book;
      return publicBook;
    }

    const fileName = uniqueSafeFileName(file.originalname);
    permanentPath = path.join(uploadsDir, fileName);
    fs.copyFileSync(file.path, permanentPath);
    return await persistBook({
      permanentPath,
      fileName,
      source: "upload",
      ownerId,
    });
  } catch (error) {
    if (permanentPath) fs.rmSync(permanentPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(file.path, { force: true });
  }
}
