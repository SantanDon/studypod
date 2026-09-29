/** Browser fallback WAV assembly. Converts sample values; never relabels float bytes as PCM. */
export interface WavPart {
    buffer: ArrayBuffer;
    pauseAfterMs?: number;
}
interface WavData {
    view: DataView;
    offset: number;
    bytes: number;
    channels: number;
    sampleRate: number;
    bits: number;
    format: number;
}
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const word = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
function readWav(buffer: ArrayBuffer): WavData {
    if (buffer.byteLength < 44)
        throw new Error('WAV segment is truncated');
    const v = new DataView(buffer);
    if (word(v, 0) !== 'RIFF' || word(v, 8) !== 'WAVE')
        throw new Error('Unsupported WAV container in podcast segment');
    const end = v.getUint32(4, true) + 8;
    if (end > buffer.byteLength || end < 44)
        throw new Error('WAV segment is truncated');
    let format: Omit<WavData, 'view' | 'offset' | 'bytes'> | undefined;
    let data: {
        offset: number;
        bytes: number;
    } | undefined;
    for (let at = 12; at + 8 <= end;) {
        const size = v.getUint32(at + 4, true);
        const payload = at + 8;
        if (payload + size > end)
            throw new Error('WAV chunk exceeds the segment length');
        const id = word(v, at);
        if (id === 'fmt ') {
            if (format || size < 16)
                throw new Error('Invalid WAV format chunk');
            const encoding = v.getUint16(payload, true);
            const channels = v.getUint16(payload + 2, true);
            const sampleRate = v.getUint32(payload + 4, true);
            const bits = v.getUint16(payload + 14, true);
            if (!((encoding === 1 && [8, 16, 24, 32].includes(bits)) || (encoding === 3 && [32, 64].includes(bits))))
                throw new Error('Unsupported WAV sample encoding');
            if (channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000)
                throw new Error('Invalid WAV channel count or sample rate');
            const align = channels * bits / 8;
            if (v.getUint16(payload + 12, true) !== align || v.getUint32(payload + 8, true) !== sampleRate * align)
                throw new Error('Inconsistent WAV sample format');
            format = { format: encoding, channels, sampleRate, bits };
        }
        else if (id === 'data') {
            if (data || size === 0)
                throw new Error('Missing or ambiguous WAV sample data');
            data = { offset: payload, bytes: size };
        }
        at = payload + size + (size % 2);
    }
    if (!format || !data || data.bytes % (format.channels * format.bits / 8) !== 0)
        throw new Error('WAV segment has no complete sample frames');
    return { view: v, ...data, ...format };
}
function readSample(wav: WavData, at: number): number {
    const v = wav.view;
    if (wav.format === 3) {
        const value = wav.bits === 32 ? v.getFloat32(at, true) : v.getFloat64(at, true);
        if (!Number.isFinite(value))
            throw new Error('WAV contains non-finite audio samples');
        return value;
    }
    if (wav.bits === 8)
        return (v.getUint8(at) - 128) / 128;
    if (wav.bits === 16)
        return v.getInt16(at, true) / 32768;
    if (wav.bits === 24) {
        const value = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
        return ((value << 8) >> 8) / 8388608;
    }
    return v.getInt32(at, true) / 2147483648;
}
export function concatenatePcmWav(parts: WavPart[]): ArrayBuffer {
    if (!parts.length || parts.length > 10000)
        throw new Error('Invalid number of podcast audio segments');
    const decoded = parts.map((part) => readWav(part.buffer));
    const { sampleRate, channels } = decoded[0];
    let samples = 0;
    const pauses: number[] = [];
    for (let i = 0; i < decoded.length; i++) {
        const wav = decoded[i];
        if (wav.sampleRate !== sampleRate || wav.channels !== channels)
            throw new Error('Podcast segments have different sample rates or channels; resampling is required');
        const pauseMs = parts[i].pauseAfterMs ?? 0;
        if (!Number.isFinite(pauseMs) || pauseMs < 0 || pauseMs > 30000)
            throw new Error('Invalid podcast turn pause');
        const silence = i === decoded.length - 1 ? 0 : Math.round(sampleRate * pauseMs / 1000) * channels;
        pauses.push(silence);
        samples += wav.bytes / (wav.bits / 8) + silence;
        if (44 + samples * 2 > MAX_OUTPUT_BYTES)
            throw new Error('Podcast audio exceeds the browser assembly limit; use a shorter episode');
    }
    const result = new ArrayBuffer(44 + samples * 2);
    const out = new DataView(result);
    const write = (at: number, value: string) => { for (let i = 0; i < value.length; i++)
        out.setUint8(at + i, value.charCodeAt(i)); };
    write(0, 'RIFF');
    out.setUint32(4, result.byteLength - 8, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, channels, true);
    out.setUint32(24, sampleRate, true);
    out.setUint32(28, sampleRate * channels * 2, true);
    out.setUint16(32, channels * 2, true);
    out.setUint16(34, 16, true);
    write(36, 'data');
    out.setUint32(40, samples * 2, true);
    let position = 44;
    decoded.forEach((wav, i) => {
        for (let at = wav.offset; at < wav.offset + wav.bytes; at += wav.bits / 8) {
            const sample = Math.max(-1, Math.min(1, readSample(wav, at)));
            out.setInt16(position, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
            position += 2;
        }
        position += pauses[i] * 2; // ArrayBuffer is zero initialized: valid signed-PCM silence.
    });
    return result;
}
