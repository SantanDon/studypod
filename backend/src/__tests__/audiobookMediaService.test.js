import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalAudiobookWavArgs,
  chapterCacheKeyFor,
  createBookContentSignature,
  finalAudiobookEncodingArgs,
  isCanonicalAudiobookWav,
  isUsableAudioFile,
  readWavFormat,
  wavDurationSeconds,
} from "../services/audiobookMediaService.js";

const tempPaths = [];

afterEach(() => {
  for (const target of tempPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

const writeTestWav = (durationSeconds = 2) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-media-"));
  tempPaths.push(dir);
  const filePath = path.join(dir, "chapter.wav");
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * durationSeconds * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(dataSize)]));
  return filePath;
};

describe("audiobookMediaService", () => {
  it("changes render and cache identity when chapter content changes", () => {
    const chapterIds = ["chapter-1"];
    const firstManifest = {
      chapters: [{ id: "chapter-1", contentHash: "content-a" }],
    };
    const secondManifest = {
      chapters: [{ id: "chapter-1", contentHash: "content-b" }],
    };

    expect(createBookContentSignature(firstManifest, chapterIds)).not.toBe(
      createBookContentSignature(secondManifest, chapterIds),
    );
    expect(
      chapterCacheKeyFor({
        fileName: "book.pdf",
        pipelineVersion: "v2",
        chapterId: "chapter-1",
        voice: "af_heart",
        provider: "mock",
        narrationSignature: "narration",
        contentHash: "content-a",
      }),
    ).not.toBe(
      chapterCacheKeyFor({
        fileName: "book.pdf",
        pipelineVersion: "v2",
        chapterId: "chapter-1",
        voice: "af_heart",
        provider: "mock",
        narrationSignature: "narration",
        contentHash: "content-b",
      }),
    );
  });

  it("validates WAV media and reads its duration without loading the full file", () => {
    const filePath = writeTestWav(3);
    expect(isUsableAudioFile(filePath)).toBe(true);
    expect(wavDurationSeconds(filePath)).toBeCloseTo(3, 4);
    expect(readWavFormat(filePath)).toEqual({
      formatTag: 1,
      channels: 1,
      sampleRate: 16_000,
      bitsPerSample: 16,
    });
    expect(isCanonicalAudiobookWav(filePath)).toBe(false);
  });

  it("defines a canonical 24 kHz mono PCM chapter conversion", () => {
    const args = canonicalAudiobookWavArgs({
      inputPath: "raw.wav",
      outputPath: "canonical.wav",
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "-ar",
        "24000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
      ]),
    );
    expect(args.at(-1)).toBe("canonical.wav");
  });

  it("normalizes MP3 exports to 44.1 kHz before libmp3lame encoding", () => {
    const args = finalAudiobookEncodingArgs({
      listPath: "chapters.txt",
      outputPath: "book.mp3",
      format: "mp3",
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "-af",
        "aresample=44100,aformat=sample_fmts=s16:channel_layouts=mono",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
      ]),
    );
    expect(args.at(-1)).toBe("book.mp3");
  });

  it("keeps WAV and M4B exports on their expected codecs", () => {
    expect(
      finalAudiobookEncodingArgs({
        listPath: "chapters.txt",
        outputPath: "book.wav",
        format: "wav",
      }),
    ).toEqual(expect.arrayContaining(["-c:a", "pcm_s16le"]));
    expect(
      finalAudiobookEncodingArgs({
        listPath: "chapters.txt",
        outputPath: "book.m4b",
        format: "m4b",
      }),
    ).toEqual(expect.arrayContaining(["-c:a", "aac", "-movflags", "+faststart"]));
  });
});
