import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isUsableAudioFile, isCanonicalAudiobookWav, wavDurationSeconds, finalAudiobookEncodingArgs, hasCompleteChapterDuration } from '../services/audiobookMediaService.js';
const directories = [];
afterEach(() => { for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true }); });
function fixture({ rf64 = false, float = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studypod-integrity-'));
    directories.push(dir);
    const filename = path.join(dir, 'sample.wav');
    const dataBytes = float ? 96000 : 48000;
    const headerSize = rf64 ? 80 : 44;
    const b = Buffer.alloc(headerSize + dataBytes);
    b.write(rf64 ? 'RF64' : 'RIFF');
    b.writeUInt32LE(rf64 ? 0xffffffff : b.length - 8, 4);
    b.write('WAVE', 8);
    let offset = 12;
    if (rf64) {
        b.write('ds64', offset);
        b.writeUInt32LE(28, offset + 4);
        b.writeBigUInt64LE(BigInt(b.length - 8), offset + 8);
        b.writeBigUInt64LE(BigInt(dataBytes), offset + 16);
        b.writeBigUInt64LE(24000n, offset + 24);
        offset += 36;
    }
    b.write('fmt ', offset);
    b.writeUInt32LE(16, offset + 4);
    b.writeUInt16LE(float ? 3 : 1, offset + 8);
    b.writeUInt16LE(1, offset + 10);
    b.writeUInt32LE(24000, offset + 12);
    b.writeUInt32LE(dataBytes, offset + 16);
    b.writeUInt16LE(float ? 4 : 2, offset + 20);
    b.writeUInt16LE(float ? 32 : 16, offset + 22);
    b.write('data', offset + 24);
    b.writeUInt32LE(rf64 ? 0xffffffff : dataBytes, offset + 28);
    fs.writeFileSync(filename, b);
    return { filename, buffer: b, fmt: offset, data: offset + 28 };
}
describe('completed audiobook cache integrity', () => {
    it.each([{ rf64: false }, { rf64: true }, { float: true }])('accepts complete supported WAV data: %o', (options) => {
        const { filename } = fixture(options);
        expect(isUsableAudioFile(filename)).toBe(true);
        expect(wavDurationSeconds(filename)).toBe(1);
    });
    it('rejects a truncated cache even when its intact header declares the original duration', () => {
        const { filename } = fixture();
        fs.truncateSync(filename, 1200);
        expect(isUsableAudioFile(filename)).toBe(false);
        expect(isCanonicalAudiobookWav(filename)).toBe(false);
        expect(wavDurationSeconds(filename)).toBe(0);
    });
    it('rejects an unfinished zero-length data header instead of counting unrelated trailing bytes as audio', () => {
        const { filename, buffer, data } = fixture();
        buffer.writeUInt32LE(0, data);
        fs.writeFileSync(filename, buffer);
        expect(isUsableAudioFile(filename)).toBe(false);
    });
    it('rejects inconsistent sample-rate/byte-rate metadata', () => {
        const { filename, buffer, fmt } = fixture();
        buffer.writeUInt32LE(1, fmt + 16);
        fs.writeFileSync(filename, buffer);
        expect(isUsableAudioFile(filename)).toBe(false);
        expect(wavDurationSeconds(filename)).toBe(0);
    });
    it('rejects partial PCM sample frames', () => {
        const { filename, buffer, data } = fixture();
        buffer.writeUInt32LE(47999, data);
        fs.writeFileSync(filename, buffer);
        expect(isUsableAudioFile(filename)).toBe(false);
    });
    it('rejects a generic file of sufficient size masquerading as WAV', () => {
        const { filename } = fixture();
        fs.writeFileSync(filename, Buffer.alloc(200));
        expect(isUsableAudioFile(filename)).toBe(false);
    });
    it('rejects an RF64 header that claims more data than the file actually contains', () => {
        const { filename, buffer } = fixture({ rf64: true });
        buffer.writeBigUInt64LE(9000000000n, 28);
        fs.writeFileSync(filename, buffer);
        expect(isUsableAudioFile(filename)).toBe(false);
    });
    it('exports long WAV files using RF64 auto rather than overflowing the RIFF size', () => {
        expect(finalAudiobookEncodingArgs({ listPath: 'chapters.txt', outputPath: 'book.wav', format: 'wav' })).toEqual(expect.arrayContaining(['-rf64', 'auto']));
    });
});
describe('full-export duration gate', () => {
    it('accepts all chapters plus pauses', () => expect(hasCompleteChapterDuration(63, [20, 20, 20])).toBe(true));
    it('rejects a short file masquerading as a full book', () => expect(hasCompleteChapterDuration(120, [1800, 1800, 1800])).toBe(false));
    it.each([0, NaN, Infinity, -1])('rejects invalid exported duration %s', (duration) => expect(hasCompleteChapterDuration(duration, [10])).toBe(false));
    it('requires known durations for every chapter', () => { expect(hasCompleteChapterDuration(100, [50, 0])).toBe(false); expect(hasCompleteChapterDuration(100, [])).toBe(false); });
});
