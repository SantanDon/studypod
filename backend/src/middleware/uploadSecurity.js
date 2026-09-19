const DEFAULT_FIELD_NAME_BYTES = 64;
const DEFAULT_FIELD_VALUE_BYTES = 8 * 1024;
const DEFAULT_FIELD_NESTING_DEPTH = 1;

/**
 * Keep single-file multipart endpoints deliberately narrow.
 * Multer forwards these limits to Busboy and also enforces field nesting depth.
 */
export function singleFileUploadLimits(fileSize, { fields = 0 } = {}) {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new TypeError("fileSize must be a positive finite number");
  }
  if (!Number.isInteger(fields) || fields < 0) {
    throw new TypeError("fields must be a non-negative integer");
  }

  return {
    fileSize,
    files: 1,
    fields,
    parts: fields + 1,
    fieldNameSize: DEFAULT_FIELD_NAME_BYTES,
    fieldSize: DEFAULT_FIELD_VALUE_BYTES,
    fieldNestingDepth: DEFAULT_FIELD_NESTING_DEPTH,
  };
}
