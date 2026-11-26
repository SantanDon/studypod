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
  // Multer's disk storage assigns each upload a random 16-byte hex filename.
  const storedName = file.filename;
  if (typeof storedName !== "string" || storedName.length !== 32 || !/^[a-f0-9]+$/.test(storedName)) {
    throw new Error("Invalid temporary upload identifier");
  }
  const tempPath = path.join(uploadsDir, "temp", path.basename(storedName));
  if (!fs.lstatSync(tempPath).isFile()) throw new Error("Expected a regular upload file");
  let permanentPath;
  try {
    if (!parseBookPersistenceOption(persistOption)) {
      const fileName = sanitizeFileName(file.originalname);
      const extraction = await extractBook(tempPath, fileName);
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
    const destination = path.join(uploadsDir, path.basename(fileName));
    fs.copyFileSync(tempPath, destination, fs.constants.COPYFILE_EXCL);
    permanentPath = destination;
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
    fs.rmSync(tempPath, { force: true });
  }
}
