import fs from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const safeCachePart = (value = "part") =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "part";

export const isUsableAudioFile = (filePath) => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size >= 44;
  } catch {
    return false;
  }
};

const WAV_SCAN_BYTES = 256 * 1024;

function readWavMetadata(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const scanSize = Math.min(stat.size, WAV_SCAN_BYTES);
    if (scanSize < 44) return null;

    const buffer = Buffer.alloc(scanSize);
    const descriptor = fs.openSync(filePath, "r");
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(descriptor, buffer, 0, scanSize, 0);
    } finally {
      fs.closeSync(descriptor);
    }

    const container = buffer.toString("ascii", 0, 4);
    if (
      !["RIFF", "RF64"].includes(container) ||
      buffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
      return null;
    }

    let offset = 12;
    let format = null;
    let dataOffset = null;
    let dataSize = null;
    let rf64DataSize = null;

    while (offset + 8 <= bytesRead) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const payloadOffset = offset + 8;

      if (chunkId === "ds64" && payloadOffset + 16 <= bytesRead) {
        const size64 = buffer.readBigUInt64LE(payloadOffset + 8);
        if (size64 <= BigInt(Number.MAX_SAFE_INTEGER)) {
          rf64DataSize = Number(size64);
        }
      } else if (chunkId === "fmt " && payloadOffset + 16 <= bytesRead) {
        format = {
          formatTag: buffer.readUInt16LE(payloadOffset),
          channels: buffer.readUInt16LE(payloadOffset + 2),
          sampleRate: buffer.readUInt32LE(payloadOffset + 4),
          byteRate: buffer.readUInt32LE(payloadOffset + 8),
          bitsPerSample: buffer.readUInt16LE(payloadOffset + 14),
        };
      } else if (chunkId === "data") {
        dataOffset = payloadOffset;
        dataSize =
          chunkSize === 0xffffffff ? rf64DataSize : Number(chunkSize);
        if (!Number.isFinite(dataSize) || dataSize <= 0) {
          dataSize = Math.max(0, stat.size - payloadOffset);
        }
        break;
      }

      const paddedSize = chunkSize + (chunkSize % 2);
      if (chunkSize === 0xffffffff || paddedSize < 0) break;
      offset = payloadOffset + paddedSize;
    }

    return {
      container,
      fileSize: stat.size,
      format,
      dataOffset,
      dataSize,
    };
  } catch {
    return null;
  }
}

export function readWavFormat(filePath) {
  const metadata = readWavMetadata(filePath);
  if (!metadata?.format) return null;
  const { formatTag, channels, sampleRate, bitsPerSample } = metadata.format;
  return { formatTag, channels, sampleRate, bitsPerSample };
}

export function isCanonicalAudiobookWav(filePath) {
  const format = readWavFormat(filePath);
  return Boolean(
    format &&
      format.formatTag === 1 &&
      format.channels === 1 &&
      format.sampleRate === 24_000 &&
      format.bitsPerSample === 16,
  );
}

export function canonicalAudiobookWavArgs({ inputPath, outputPath }) {
  return [
    "-y",
    "-v",
    "error",
    "-i",
    inputPath,
    "-ar",
    "24000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ];
}

export function finalAudiobookEncodingArgs({
  listPath,
  outputPath,
  format = "mp3",
}) {
  const normalizedFormat = ["mp3", "m4b", "wav"].includes(format)
    ? format
    : "mp3";
  const inputArgs = ["-y", "-f", "concat", "-safe", "0", "-i", listPath];

  if (normalizedFormat === "wav") {
    return [...inputArgs, "-c:a", "pcm_s16le", outputPath];
  }

  if (normalizedFormat === "m4b") {
    return [
      ...inputArgs,
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      outputPath,
    ];
  }

  // FFmpeg 8.1.1/libmp3lame can assert inside LAME's psychoacoustic model
  // when encoding StudyPod's concatenated 24 kHz mono float WAV stream directly.
  // Normalize both sample rate and sample format before LAME. This preserves the
  // chapter WAV cache while avoiding the concat-only encoder crash.
  return [
    ...inputArgs,
    "-af",
    "aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-write_xing",
    "1",
    outputPath,
  ];
}

export function createBookContentSignature(manifest, chapterIds = []) {
  const chapterById = new Map(
    (manifest?.chapters || []).map((chapter) => [String(chapter.id), chapter]),
  );
  const chapterSignatures = chapterIds.map((chapterId) => {
    const chapter = chapterById.get(String(chapterId));
    const contentHash =
      chapter?.contentHash ||
      createHash("sha256")
        .update(String(chapter?.narrationText || chapter?.text || ""))
        .digest("hex");
    return `${chapterId}:${contentHash}`;
  });
  return createHash("sha256")
    .update(chapterSignatures.join("|"))
    .digest("hex")
    .slice(0, 24);
}

export function chapterCacheKeyFor({
  fileName,
  pipelineVersion,
  chapterId,
  voice,
  provider,
  narrationSignature,
  contentHash,
}) {
  return (
    [
      safeCachePart(fileName),
      safeCachePart(pipelineVersion),
      safeCachePart(chapterId),
      safeCachePart(voice),
      safeCachePart(provider),
      safeCachePart(contentHash || "legacy-content"),
      safeCachePart(narrationSignature),
    ].join("_") + ".wav"
  );
}

export function wavDurationSeconds(filePath) {
  const metadata = readWavMetadata(filePath);
  const byteRate = metadata?.format?.byteRate || 0;
  const dataSize = metadata?.dataSize || 0;
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
}

export async function probeAudioDurationSeconds(filePath) {
  const wavDuration = wavDurationSeconds(filePath);
  if (wavDuration > 0) return wavDuration;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const duration = Number(String(stdout || "").trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}
