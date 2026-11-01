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
const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;
// Prefer full speech-band quality, reducing only for unusually long episodes
// so a 30-minute recording still fits the account API's existing size limit.
const OUTPUT_SAMPLE_RATES = [24000, 16000, 12000, 8000] as const;
export function selectSpeechPcmSampleRate(inputSampleRate: number, inputFrames: number, extraFrames = 0): number {
    for (const rate of OUTPUT_SAMPLE_RATES) {
        if (rate > inputSampleRate) continue;
        const frames = Math.round(inputFrames * rate / inputSampleRate) + extraFrames;
        if (44 + frames * 2 <= MAX_OUTPUT_BYTES) return rate;
    }
    throw new Error('Podcast audio exceeds the 48 MiB save limit even at 8 kHz mono; shorten the episode');
}
export async function encodeSpeechPcmWav(channels: readonly Float32Array[], inputSampleRate: number, isCancelled: () => boolean = () => false): Promise<ArrayBuffer> {
    if (!channels.length || channels.length > 8 || !Number.isFinite(inputSampleRate) || inputSampleRate < 8000 || inputSampleRate > 192000)
        throw new Error('Invalid audio channels or sample rate');
    const inputFrames = channels[0].length;
    if (!inputFrames || channels.some(channel => channel.length !== inputFrames))
        throw new Error('Audio channels have inconsistent sample lengths');
    const sampleRate = selectSpeechPcmSampleRate(inputSampleRate, inputFrames);
    const outputFrames = Math.round(inputFrames * sampleRate / inputSampleRate);
    const dataBytes = outputFrames * 2;
    if (44 + dataBytes > MAX_OUTPUT_BYTES)
        throw new Error('Podcast audio exceeds the 48 MiB save limit; use a shorter episode');
    const result = new ArrayBuffer(44 + dataBytes);
    const out = new DataView(result);
    const write = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out.setUint8(at + i, value.charCodeAt(i)); };
    write(0, 'RIFF'); out.setUint32(4, result.byteLength - 8, true); write(8, 'WAVE');
    write(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
    out.setUint16(22, 1, true); out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 2, true);
    out.setUint16(32, 2, true); out.setUint16(34, 16, true); write(36, 'data'); out.setUint32(40, dataBytes, true);
    const ratio = inputSampleRate / sampleRate;
    for (let frame = 0; frame < outputFrames; frame++) {
        if ((frame & 0x3fff) === 0) {
            if (isCancelled()) throw new DOMException('Podcast audio assembly cancelled.', 'AbortError');
            if (frame) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        const start = frame * ratio;
        const end = Math.min(inputFrames, (frame + 1) * ratio);
        let sum = 0;
        let weight = 0;
        for (let sourceFrame = Math.floor(start); sourceFrame < Math.ceil(end); sourceFrame++) {
            const overlap = Math.min(end, sourceFrame + 1) - Math.max(start, sourceFrame);
            if (overlap <= 0) continue;
            let frameSum = 0;
            for (const channel of channels) {
                const value = channel[sourceFrame];
                if (!Number.isFinite(value)) throw new Error('Audio contains non-finite samples');
                frameSum += value;
            }
            sum += (frameSum / channels.length) * overlap;
            weight += overlap;
        }
        const sample = Math.max(-1, Math.min(1, sum / weight));
        out.setInt16(44 + frame * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
    }
    if (isCancelled()) throw new DOMException('Podcast audio assembly cancelled.', 'AbortError');
    return result;
}
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
    let at = 12;
    while (at + 8 <= end) {
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
        if (at > end)
            throw new Error('WAV chunk padding is truncated in the podcast segment');
    }
    if (at !== end)
        throw new Error('WAV segment ends with an incomplete chunk header');
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
    const { sampleRate: inputSampleRate, channels: inputChannels } = decoded[0];
    let totalInputFrames = 0;
    let totalPauseMs = 0;
    for (let i = 0; i < decoded.length; i++) {
        const wav = decoded[i];
        const frames = wav.bytes / (wav.bits / 8 * inputChannels);
        totalInputFrames += frames;
        if (i < decoded.length - 1) totalPauseMs += parts[i].pauseAfterMs ?? 0;
    }
    const sampleRate = selectSpeechPcmSampleRate(inputSampleRate, totalInputFrames + Math.ceil(totalPauseMs * inputSampleRate / 1000));
    const channels = 1;
    let samples = 0;
    const pauses: number[] = [];
    for (let i = 0; i < decoded.length; i++) {
        const wav = decoded[i];
        if (wav.sampleRate !== inputSampleRate || wav.channels !== inputChannels)
            throw new Error('Podcast segments have different sample rates or channels; resampling is required');
        const pauseMs = parts[i].pauseAfterMs ?? 0;
        if (!Number.isFinite(pauseMs) || pauseMs < 0 || pauseMs > 30000)
            throw new Error('Invalid podcast turn pause');
        const silence = i === decoded.length - 1 ? 0 : Math.round(sampleRate * pauseMs / 1000);
        pauses.push(silence);
        const inputFrames = wav.bytes / (wav.bits / 8 * inputChannels);
        samples += Math.round(inputFrames * sampleRate / inputSampleRate) + silence;
        if (44 + samples * 2 > MAX_OUTPUT_BYTES)
            throw new Error('Podcast audio exceeds the 48 MiB save limit; shorten the episode');
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
        const inputFrames = wav.bytes / (wav.bits / 8 * inputChannels);
        const outputFrames = Math.round(inputFrames * sampleRate / inputSampleRate);
        const ratio = inputSampleRate / sampleRate;
        for (let frame = 0; frame < outputFrames; frame++) {
            if (ratio === 1 && inputChannels === 1 && wav.format === 1 && wav.bits === 16) {
                out.setInt16(position, wav.view.getInt16(wav.offset + frame * 2, true), true);
                position += 2;
                continue;
            }
            // Average each source-time interval, which downmixes channels and
            // provides a simple low-pass filter when reducing the sample rate.
            const start = frame * ratio;
            const end = Math.min(inputFrames, (frame + 1) * ratio);
            let sum = 0;
            let weight = 0;
            for (let sourceFrame = Math.floor(start); sourceFrame < Math.ceil(end); sourceFrame++) {
                const overlap = Math.min(end, sourceFrame + 1) - Math.max(start, sourceFrame);
                if (overlap <= 0) continue;
                let frameSum = 0;
                for (let channel = 0; channel < inputChannels; channel++) {
                    const at = wav.offset + (sourceFrame * inputChannels + channel) * (wav.bits / 8);
                    frameSum += readSample(wav, at);
                }
                sum += (frameSum / inputChannels) * overlap;
                weight += overlap;
            }
            const sample = Math.max(-1, Math.min(1, sum / weight));
            out.setInt16(position, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
            position += 2;
        }
        position += pauses[i] * 2; // ArrayBuffer is zero initialized: valid signed-PCM silence.
    });
    return result;
}
