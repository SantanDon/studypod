import { describe, expect, it } from 'vitest';
import { concatenatePcmWav } from '@/lib/tts/pcmWav';
function wav(values: number[], { format = 3, bits = 32, rate = 24000, channels = 1 } = {}) {
    const bytes = values.length * bits / 8;
    const buffer = new ArrayBuffer(44 + bytes);
    const v = new DataView(buffer);
    const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++)
        v.setUint8(at + i, value.charCodeAt(i)); };
    text(0, 'RIFF');
    v.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, format, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * channels * bits / 8, true);
    v.setUint16(32, channels * bits / 8, true);
    v.setUint16(34, bits, true);
    text(36, 'data');
    v.setUint32(40, bytes, true);
    values.forEach((value, i) => { if (format === 3)
        v.setFloat32(44 + i * 4, value, true);
    else
        v.setInt16(44 + i * 2, value, true); });
    return buffer;
}
const samples = (buffer: ArrayBuffer) => { const v = new DataView(buffer); return Array.from({ length: (buffer.byteLength - 44) / 2 }, (_, i) => v.getInt16(44 + i * 2, true)); };
describe('podcast WAV fallback integrity', () => {
    it('converts float sample values to PCM16 rather than copying float bit patterns', () => {
        const result = concatenatePcmWav([{ buffer: wav([0, 0.5, -0.5, 1, -1]) }]);
        expect(new DataView(result).getUint16(20, true)).toBe(1);
        expect(new DataView(result).getUint16(34, true)).toBe(16);
        expect(samples(result)).toEqual([0, 16384, -16384, 32767, -32768]);
    });
    it('joins different supported sample formats in the original order', () => {
        const result = concatenatePcmWav([{ buffer: wav([0.5]) }, { buffer: wav([-16384], { format: 1, bits: 16 }) }]);
        expect(samples(result)).toEqual([16384, -16384]);
    });
    it('inserts exactly one turn gap and no trailing gap', () => {
        const result = concatenatePcmWav([{ buffer: wav([1]), pauseAfterMs: 1 }, { buffer: wav([-1]), pauseAfterMs: 100 }]);
        expect(samples(result)).toEqual([32767, ...Array(24).fill(0), -32768]);
    });
    it('clips finite out-of-range samples safely', () => expect(samples(concatenatePcmWav([{ buffer: wav([2, -2]) }]))).toEqual([32767, -32768]));
    it.each([NaN, Infinity, -Infinity])('rejects non-finite samples %s', value => expect(() => concatenatePcmWav([{ buffer: wav([value]) }])).toThrow('non-finite'));
    it('rejects mismatched rates instead of silently changing pitch or duration', () => expect(() => concatenatePcmWav([{ buffer: wav([1]) }, { buffer: wav([1], { rate: 16000 }) }])).toThrow('resampling'));
    it('rejects mismatched channel counts', () => expect(() => concatenatePcmWav([{ buffer: wav([1]) }, { buffer: wav([1, 1], { channels: 2 }) }])).toThrow('resampling'));
    it('rejects truncated data instead of shortening the output', () => expect(() => concatenatePcmWav([{ buffer: wav([1, 1]).slice(0, 48) }])).toThrow('truncated'));
    it('rejects a missing segment rather than exporting the rest', () => expect(() => concatenatePcmWav([{ buffer: wav([1]) }, { buffer: new ArrayBuffer(0) }])).toThrow('truncated'));
    it('rejects nonsensical pauses', () => expect(() => concatenatePcmWav([{ buffer: wav([1]), pauseAfterMs: Infinity }])).toThrow('pause'));
    it('rejects an empty render', () => expect(() => concatenatePcmWav([])).toThrow('number'));
});
