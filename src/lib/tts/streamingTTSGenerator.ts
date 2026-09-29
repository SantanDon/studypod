import { concatenatePcmWav } from "./pcmWav";
/**
 * Streaming TTS Generator - HYBRID VERSION
 *
 * Uses Web Worker with Kokoro TTS for high-quality audio (non-blocking)
 * Falls back to Web Speech API if workers aren't supported
 *
 * Priority:
 * 1. Web Worker + Kokoro TTS (high quality, non-blocking)
 * 2. Web Speech API (lower quality, but always works)
 */

import { PodcastScript, PodcastSegment } from "../podcastGenerator";
import type { SynthesisResult, TTSWorkerManager } from "./ttsWorker";
import { AudioContentCleaner } from "./AudioContentCleaner";
import { AudioValidator } from "./audioValidator";

export interface StreamingConfig {
  host1Voice: string;
  host2Voice: string;
  speed: number;
  batchSize: number;
  yieldDuration: number;
  pauseBetweenSegments: number;
  useKokoro?: boolean;
  forceWebSpeech?: boolean;
  speakerVoiceMap?: Record<string, string>; // Custom speaker → voice mapping
}

export interface StreamingProgress {
  phase: "loading" | "generating" | "complete" | "error" | "cancelled";
  currentSegment: number;
  totalSegments: number;
  percentage: number;
  message: string;
  estimatedTimeRemaining?: number;
  canPlay: boolean;
  usingKokoro?: boolean;
}

export interface StreamingResult {
  audioUrls: string[];
  totalDuration: number;
  segmentsReady: number;
}

type ProgressCallback = (progress: StreamingProgress) => void;
type AudioReadyCallback = (result: StreamingResult) => void;

const DEFAULT_CONFIG: StreamingConfig = {
  host1Voice: "am_onyx",
  host2Voice: "af_nova",
  speed: 0.9,
  batchSize: 1,
  yieldDuration: 50,
  pauseBetweenSegments: 600,
  useKokoro: true, // Enable Kokoro TTS via Web Worker
  forceWebSpeech: false, // Don't force Web Speech - use Kokoro if available
};

export function podcastPauseMilliseconds(
  currentSpeaker: string,
  nextSpeaker: string | undefined,
  format: "dialogue" | "solo" = "dialogue",
  basePauseMs = DEFAULT_CONFIG.pauseBetweenSegments,
): number {
  if (!nextSpeaker) return 0;
  const boundedPause = Math.min(2000, Math.max(0, Number(basePauseMs) || 0));
  return format === "solo" || currentSpeaker === nextSpeaker
    ? Math.round(boundedPause / 2)
    : Math.round(boundedPause);
}

interface GeneratedAudio {
  url: string;
  duration: number;
  speaker: string;
  text: string;
  isKokoro: boolean;
  // Store blob too if possible, for combination
  blob?: Blob;
}

class StreamingTTSGenerator {
  private isGenerating = false;
  private shouldCancel = false;
  /**
   * Execution identity for the current run. `shouldCancel` alone is not enough: it is a
   * single shared boolean that a new start resets, so a superseded run that is still
   * inside an `await` can wake up believing it is still the active run and write its
   * late audio/progress into the new one. Every run takes a new id; `cancel()` and a
   * new start both invalidate the previous one, and callbacks tagged with a stale id
   * are dropped.
   */
  private runId = 0;
  private generatedAudios: GeneratedAudio[] = [];
  private currentScript: PodcastScript | null = null;
  private currentConfig: StreamingConfig = { ...DEFAULT_CONFIG };
  private workerManager: TTSWorkerManager | null = null;
  private usingKokoro = false;
  private audioElements: HTMLAudioElement[] = [];
  private isPlaying = false; // Prevent double playback
  private isSequencePlaying = false;

  /**
   * Check if Kokoro via Web Worker is available
   */
  async isKokoroAvailable(): Promise<boolean> {
    try {
      // Check for Worker support
      if (typeof Worker === "undefined") return false;

      // Check for SharedArrayBuffer (required for ONNX threading)
      if (typeof SharedArrayBuffer === "undefined") {
        console.warn(
          "SharedArrayBuffer not available - COOP/COEP headers may be missing",
        );
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get or create the worker manager (lazy load)
   */
  private async getWorkerManager(): Promise<TTSWorkerManager> {
    if (!this.workerManager) {
      const { getTTSWorkerManager } = await import("./ttsWorker");
      this.workerManager = getTTSWorkerManager();
    }
    return this.workerManager;
  }

  /**
   * Start streaming generation
   */
  async startStreaming(
    script: PodcastScript,
    config: Partial<StreamingConfig>,
    onProgress: ProgressCallback,
    onAudioReady: AudioReadyCallback,
  ): Promise<void> {
    if (this.isGenerating) {
      // Silently returning here leaves the store already switched to the new script
      // and `isGenerating: true` with no generator actually running, so the UI spins
      // forever. Fail loudly so the caller can surface it.
      throw new Error(
        "Podcast audio generation is already running. Cancel or finish it first.",
      );
    }

    // Take a fresh execution identity. Anything still in flight from a previous run is
    // now stale and must not report into this one.
    const runId = ++this.runId;
    const isCurrentRun = () => this.runId === runId;
    const tagRun = <T extends unknown[]>(
      callback: (...args: T) => void,
    ): ((...args: T) => void) => {
      return (...args: T) => {
        if (!isCurrentRun()) return;
        callback(...args);
      };
    };
    onProgress = tagRun(onProgress);
    onAudioReady = tagRun(onAudioReady);

    this.isGenerating = true;
    this.shouldCancel = false;
    this.discardGeneratedAudio();
    this.currentScript = script;
    this.audioElements = [];

    // Fill missing voice config from saved user settings
    if (!config.host1Voice || !config.host2Voice) {
      try {
        const { getPodcastAudioConfig } =
          await import("./podcastAudioGenerator");
        const savedConfig = getPodcastAudioConfig();
        config = {
          ...config,
          host1Voice: config.host1Voice || savedConfig.host1Voice,
          host2Voice: config.host2Voice || savedConfig.host2Voice,
          speed: config.speed || savedConfig.speed,
        };
      } catch {
        // Fall through to DEFAULT_CONFIG
      }
    }

    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.currentConfig = fullConfig;

    // Determine which TTS to use
    if (fullConfig.forceWebSpeech) {
      console.log("Using Web Speech API (forced)");
      this.usingKokoro = false;
      await this.generateWithWebSpeech(
        script,
        fullConfig,
        onProgress,
        onAudioReady,
      );
    } else if (fullConfig.useKokoro && (await this.isKokoroAvailable())) {
      console.log("Using Kokoro TTS via Web Worker");
      this.usingKokoro = true;
      await this.generateWithKokoroWorker(
        script,
        fullConfig,
        onProgress,
        onAudioReady,
      );
    } else {
      console.log("Falling back to Web Speech API");
      this.usingKokoro = false;
      await this.generateWithWebSpeech(
        script,
        fullConfig,
        onProgress,
        onAudioReady,
      );
    }
  }

  /**
   * Generate using Kokoro TTS via Web Worker - HIGH QUALITY, NON-BLOCKING
   */
  private async generateWithKokoroWorker(
    script: PodcastScript,
    config: StreamingConfig,
    onProgress: ProgressCallback,
    onAudioReady: AudioReadyCallback,
  ): Promise<void> {
    try {
      // Get or create worker manager (lazy loaded)
      const workerManager = await this.getWorkerManager();

      onProgress({
        phase: "loading",
        currentSegment: 0,
        totalSegments: script.segments.length,
        percentage: 5,
        message: "Initializing Kokoro TTS (first time may take a moment)...",
        canPlay: false,
        usingKokoro: true,
      });

      // Initialize worker if needed
      if (!workerManager.isWorkerReady()) {
        await workerManager.initialize((msg, pct) => {
          onProgress({
            phase: "loading",
            currentSegment: 0,
            totalSegments: script.segments.length,
            percentage: Math.min(20, 5 + pct * 0.15),
            message: msg,
            canPlay: false,
            usingKokoro: true,
          });
        });
      }

      if (this.shouldCancel) {
        this.cleanup("cancelled", onProgress);
        return;
      }

      // Optimize segments
      const optimizedSegments = this.optimizeSegments(script.segments);
      const totalSegments = optimizedSegments.length;

      onProgress({
        phase: "generating",
        currentSegment: 0,
        totalSegments,
        percentage: 20,
        message: `Generating ${totalSegments} audio segments...`,
        canPlay: false,
        usingKokoro: true,
      });

      // Generate each segment
      const startTime = Date.now();

      for (let i = 0; i < optimizedSegments.length; i++) {
        if (this.shouldCancel) {
          this.cleanup("cancelled", onProgress);
          return;
        }

        const segment = optimizedSegments[i];
        const voice =
          config.speakerVoiceMap?.[segment.speaker] ??
          (segment.speaker === "Alex" ? config.host1Voice : config.host2Voice);

        try {
          // Clean text for natural TTS delivery before synthesis
          const cleanText = AudioContentCleaner.cleanSegment(segment.text);

          // Generate audio via worker (non-blocking!)
          const result = await this.synthesizeWithRetry(
            workerManager,
            cleanText,
            voice,
            config.speed,
            (_msg, pct) => {
              // Per-segment progress
              const overallPct = 20 + ((i + pct / 100) / totalSegments) * 75;
              onProgress({
                phase: "generating",
                currentSegment: i + 1,
                totalSegments,
                percentage: Math.round(overallPct),
                message: `${segment.speaker}: "${cleanText.substring(0, 40)}..."`,
                canPlay: this.generatedAudios.length > 0,
                usingKokoro: true,
                estimatedTimeRemaining: this.estimateRemainingTime(
                  startTime,
                  i,
                  totalSegments,
                ),
              });
            },
            () => {
              onProgress({
                phase: "generating",
                currentSegment: i + 1,
                totalSegments,
                percentage: Math.round(20 + (i / totalSegments) * 75),
                message: `Retrying ${segment.speaker}'s line (${i + 1}/${totalSegments})...`,
                canPlay: this.generatedAudios.length > 0,
                usingKokoro: true,
              });
            },
          );

          if (this.shouldCancel) {
            if (result.audioUrl?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(result.audioUrl);
            }
            this.discardGeneratedAudio();
            this.cleanup('cancelled', onProgress);
            return;
          }
          // Store the generated audio
          this.generatedAudios.push({
            url: result.audioUrl,
            duration: result.duration,
            speaker: segment.speaker,
            text: segment.text,
            isKokoro: true,
            blob: result.audioBlob, // Store blob for combination
          });

          // Update progress
          const percentage = Math.round(20 + ((i + 1) / totalSegments) * 75);
          onProgress({
            phase: "generating",
            currentSegment: i + 1,
            totalSegments,
            percentage,
            message: `Generated ${segment.speaker}'s line (${i + 1}/${totalSegments})`,
            canPlay: true,
            usingKokoro: true,
            estimatedTimeRemaining: this.estimateRemainingTime(
              startTime,
              i + 1,
              totalSegments,
            ),
          });

          // Notify audio ready
          onAudioReady({
            audioUrls: this.generatedAudios.map((a) => a.url),
            totalDuration: this.generatedAudios.reduce(
              (sum, a) => sum + a.duration,
              0,
            ),
            segmentsReady: this.generatedAudios.length,
          });

          // Small yield not needed when using worker - keeping loop tight for background performance
          // await new Promise(r => setTimeout(r, config.yieldDuration));
        } catch (error) {
          console.error(`Failed to generate segment ${i}:`, error);
          throw error;
        }
      }

      // Mark generation as complete BEFORE calling final callbacks
      // This ensures isRunning() returns false when handleAudioReady checks it
      this.isGenerating = false;

      // Complete
      onProgress({
        phase: "complete",
        currentSegment: totalSegments,
        totalSegments,
        percentage: 100,
        message: "High-quality podcast ready! Click play to listen.",
        canPlay: true,
        usingKokoro: true,
      });

      // Final audio ready callback - this triggers the auto-save
      onAudioReady({
        audioUrls: this.generatedAudios.map((a) => a.url),
        totalDuration: this.generatedAudios.reduce(
          (sum, a) => sum + a.duration,
          0,
        ),
        segmentsReady: this.generatedAudios.length,
      });
    } catch (error) {
      if (this.shouldCancel) {
        this.cleanup("cancelled", onProgress);
        return;
      }

      console.error("Kokoro worker generation failed:", error);

      // A partial Kokoro episode must never be mixed with the complete fallback.
      this.discardGeneratedAudio();
      console.log("Falling back to Web Speech API...");
      this.usingKokoro = false;
      await this.generateWithWebSpeech(
        script,
        config,
        onProgress,
        onAudioReady,
      );
    }
  }

  /**
   * Generate using Web Speech API - FALLBACK, NON-BLOCKING
   */
  private async generateWithWebSpeech(
    script: PodcastScript,
    config: StreamingConfig,
    onProgress: ProgressCallback,
    onAudioReady: AudioReadyCallback,
  ): Promise<void> {
    onProgress({
      phase: "loading",
      currentSegment: 0,
      totalSegments: script.segments.length,
      percentage: 5,
      message: "Preparing podcast with Web Speech...",
      canPlay: false,
      usingKokoro: false,
    });

    await new Promise((r) => setTimeout(r, 100));

    if (this.shouldCancel) {
      this.cleanup("cancelled", onProgress);
      return;
    }

    const optimizedSegments = this.optimizeSegments(script.segments);

    onProgress({
      phase: "generating",
      currentSegment: 0,
      totalSegments: optimizedSegments.length,
      percentage: 10,
      message: "Processing segments...",
      canPlay: false,
      usingKokoro: false,
    });

    for (let i = 0; i < optimizedSegments.length; i++) {
      if (this.shouldCancel) {
        this.cleanup("cancelled", onProgress);
        return;
      }

      const segment = optimizedSegments[i];
      const cleanText = AudioContentCleaner.cleanSegment(segment.text);

      const host1 = this.currentScript?.metadata?.host1Name || "Alex";
      // Create a data URL for tracking
      const segmentData = {
        type: "web-speech-segment",
        index: i,
        speaker: segment.speaker,
        text: cleanText,
        voice:
          segment.speaker === host1 ? config.host1Voice : config.host2Voice,
        speed: config.speed,
      };

      const blob = new Blob([JSON.stringify(segmentData)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      this.generatedAudios.push({
        url,
        duration: this.estimateDuration(segment.text),
        speaker: segment.speaker,
        text: segment.text,
        isKokoro: false,
        blob, // Keep blob consistent structure
      });

      const percentage = Math.round(
        10 + ((i + 1) / optimizedSegments.length) * 85,
      );
      onProgress({
        phase: "generating",
        currentSegment: i + 1,
        totalSegments: optimizedSegments.length,
        percentage,
        message: `Prepared ${segment.speaker}'s line (${i + 1}/${optimizedSegments.length})`,
        canPlay: true,
        usingKokoro: false,
      });

      onAudioReady({
        audioUrls: this.generatedAudios.map((a) => a.url),
        totalDuration: this.generatedAudios.reduce(
          (sum, a) => sum + a.duration,
          0,
        ),
        segmentsReady: this.generatedAudios.length,
      });

      await new Promise((r) => setTimeout(r, 20));
    }

    // Mark generation as complete BEFORE calling final callbacks
    this.isGenerating = false;

    onProgress({
      phase: "complete",
      currentSegment: optimizedSegments.length,
      totalSegments: optimizedSegments.length,
      percentage: 100,
      message: "Podcast ready! Click play to listen.",
      canPlay: true,
      usingKokoro: false,
    });

    // Final audio ready callback - this triggers the auto-save
    onAudioReady({
      audioUrls: this.generatedAudios.map((a) => a.url),
      totalDuration: this.generatedAudios.reduce(
        (sum, a) => sum + a.duration,
        0,
      ),
      segmentsReady: this.generatedAudios.length,
    });
  }

  /**
   * Cancel generation
   */
  cancel(): void {
    this.shouldCancel = true;
    // Invalidate the current run's execution identity so a result that is already
    // inside an `await` cannot resume and report into a later run.
    this.runId++;

    if (this.workerManager) {
      this.workerManager.cancel();
    }

    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }

    this.stopPlayback();
  }

  isRunning(): boolean {
    return this.isGenerating;
  }

  isUsingKokoro(): boolean {
    return this.usingKokoro;
  }

  getGeneratedSegments(): GeneratedAudio[] {
    return [...this.generatedAudios];
  }

  getScript(): PodcastScript | null {
    return this.currentScript;
  }

  /**
   * Ensure Web Speech voices are loaded
   */
  private async ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
    if (typeof speechSynthesis === "undefined") return [];

    let voices = speechSynthesis.getVoices();

    // Voices might not be loaded yet, wait for them
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        const checkVoices = () => {
          voices = speechSynthesis.getVoices();
          if (voices.length > 0) {
            resolve();
          } else {
            // Try again in 100ms
            setTimeout(checkVoices, 100);
          }
        };

        // Also listen for voiceschanged event
        speechSynthesis.onvoiceschanged = () => {
          voices = speechSynthesis.getVoices();
          if (voices.length > 0) resolve();
        };

        checkVoices();

        // Timeout after 2 seconds
        setTimeout(resolve, 2000);
      });
    }

    return voices;
  }

  /**
   * Play a specific segment
   */
  playSegment(index: number, onEnd?: () => void): void {
    const segment = this.generatedAudios[index];
    if (!segment) return;

    // Stop any existing playback first
    this.stopPlayback();

    this.isPlaying = true;

    if (segment.isKokoro) {
      // Play Kokoro audio via Audio element
      const audio = new Audio(segment.url);
      this.audioElements.push(audio);

      audio.onended = () => {
        const idx = this.audioElements.indexOf(audio);
        if (idx > -1) this.audioElements.splice(idx, 1);
        this.isPlaying = false;
        onEnd?.();
      };

      audio.onerror = () => {
        console.error("Audio playback error");
        this.isPlaying = false;
        onEnd?.();
      };

      audio.play().catch((err) => {
        console.error("Failed to play audio:", err);
        this.isPlaying = false;
        onEnd?.();
      });
    } else {
      // Play via Web Speech API - use async version
      this.playSegmentWithWebSpeech(segment, onEnd);
    }
  }

  /**
   * Play segment using Web Speech API with proper voice loading
   */
  private async playSegmentWithWebSpeech(
    segment: GeneratedAudio,
    onEnd?: () => void,
  ): Promise<void> {
    if (typeof speechSynthesis === "undefined") {
      this.isPlaying = false;
      onEnd?.();
      return;
    }

    // Cancel is already called in playSegment via stopPlayback

    // Ensure voices are loaded
    const voices = await this.ensureVoicesLoaded();

    const playText = AudioContentCleaner.cleanSegment(segment.text);
    const utterance = new SpeechSynthesisUtterance(playText);

    // Force English language
    utterance.lang = "en-US";

    // Filter to English voices only
    const englishVoices = voices.filter(
      (v) => v.lang.startsWith("en-") || v.lang === "en",
    );

    const host1 = this.currentScript?.metadata?.host1Name || "Alex";
    if (segment.speaker === host1) {
      // Find male English voice
      const maleVoice =
        englishVoices.find(
          (v) =>
            v.name.includes("Male") ||
            v.name.includes("David") ||
            v.name.includes("Mark") ||
            v.name.includes("James") ||
            v.name.includes("Guy") ||
            v.name.includes("Microsoft David") ||
            v.name.includes("Google US English Male"),
        ) ||
        englishVoices.find((v) => v.lang === "en-US") ||
        englishVoices[0];

      if (maleVoice) utterance.voice = maleVoice;
      utterance.pitch = 1.0;
    } else {
      // Find female English voice
      const femaleVoice =
        englishVoices.find(
          (v) =>
            v.name.includes("Female") ||
            v.name.includes("Zira") ||
            v.name.includes("Samantha") ||
            v.name.includes("Google") ||
            v.name.includes("Microsoft Zira") ||
            v.name.includes("Google US English Female"),
        ) ||
        englishVoices.find((v) => v.lang === "en-US") ||
        englishVoices[0];

      if (femaleVoice) utterance.voice = femaleVoice;
      utterance.pitch = 1.1;
    }

    utterance.rate = 1.0;
    utterance.onend = () => {
      this.isPlaying = false;
      onEnd?.();
    };
    utterance.onerror = (e) => {
      console.error("Speech synthesis error:", e);
      this.isPlaying = false;
      onEnd?.();
    };

    speechSynthesis.speak(utterance);
  }

  /**
   * Play all segments sequentially
   */
  playAll(
    startIndex: number = 0,
    onSegmentChange?: (index: number) => void,
    onComplete?: () => void,
  ): void {
    if (startIndex === 0) {
      this.isSequencePlaying = true;
    }

    if (!this.isSequencePlaying) {
      return;
    }

    if (startIndex >= this.generatedAudios.length) {
      this.isSequencePlaying = false;
      this.isPlaying = false;
      onComplete?.();
      return;
    }

    onSegmentChange?.(startIndex);

    this.playSegment(startIndex, () => {
      if (!this.isSequencePlaying) return;
      setTimeout(() => {
        if (!this.isSequencePlaying) return;
        this.playAll(startIndex + 1, onSegmentChange, onComplete);
      }, 300);
    });
  }

  /**
   * Stop all playback
   */
  stopPlayback(): void {
    this.isPlaying = false;
    this.isSequencePlaying = false;

    // Stop Audio elements
    for (const audio of this.audioElements) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    this.audioElements = [];

    // Stop Web Speech
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
  }

  /**
   * Check if currently playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Combine all audios into one valid WAV file.
   * Uses AudioContext decode/re-encode as primary path.
   * Falls back to manual WAV PCM extraction if decode fails.
   * NEVER produces a corrupt multi-header WAV.
   */
  async combineAudios(enableStudioEQ: boolean = true): Promise<string | null> {
    if (this.generatedAudios.length === 0) {
      if (this.usingKokoro) throw new Error("No generated audio is available to assemble");
      return null;
    }

    if (!this.usingKokoro) {
      console.log(
        "[StreamingTTSGenerator] Web Speech mode — no saveable audio",
      );
      return null;
    }

    const validAudios = this.generatedAudios.filter(
      (a) => !!a.blob && a.blob.size > 0,
    );
    if (this.isGenerating) throw new Error("Podcast audio is still generating");
    if (validAudios.length !== this.generatedAudios.length) throw new Error("Cannot export a podcast with missing audio segments");
    const blobs = validAudios.map((a) => a.blob!);

    console.log(
      `[StreamingTTSGenerator] Combining ${blobs.length} audio blobs. Studio EQ: ${enableStudioEQ}`,
    );

    if (blobs.length === 0) {
      console.warn("[StreamingTTSGenerator] No valid blobs to combine");
      return null;
    }

    try {
      const combined = await this.combineWavsProperly(
        validAudios,
        enableStudioEQ,
      );
      const url = URL.createObjectURL(combined);

      // Validate the combined audio for speech content
      this.validateCombinedAudio(combined);

      return url;
    } catch (e) {
      console.error("[StreamingTTSGenerator] Failed to combine audio", e);
      throw e; // An assembly failure is not browser-speech fallback or a ready download.
    }
  }

  /**
   * Validate combined audio in background — warns if silent/corrupt.
   */
  private async validateCombinedAudio(blob: Blob): Promise<void> {
    try {
      const result = await AudioValidator.validateBlob(blob);
      if (!result.hasSpeech) {
        console.warn(
          "[StreamingTTSGenerator] ⚠️ Combined audio validation:",
          result.issues.join("; "),
        );
        console.warn(
          `[StreamingTTSGenerator] RMS=${result.rms.toFixed(4)}, silence=${(result.silenceRatio * 100).toFixed(0)}%, duration=${result.duration.toFixed(1)}s`,
        );
      } else {
        console.log(
          `[StreamingTTSGenerator] ✅ Audio validated: RMS=${result.rms.toFixed(4)}, duration=${result.duration.toFixed(1)}s, ${result.sampleRate}Hz`,
        );
      }
    } catch (e) {
      console.warn("[StreamingTTSGenerator] Audio validation error:", e);
    }
  }

  /**
   * Combine WAV blobs into a single valid WAV.
   * Primary: decode via AudioContext, concatenate PCM, re-encode.
   * Fallback: manually parse WAV headers, extract PCM, assemble.
   */
  private async combineWavsProperly(
    validAudios: GeneratedAudio[],
    enableStudioEQ: boolean,
  ): Promise<Blob> {
    // Primary path: AudioContext decode + re-encode
    try {
      return await this.combineViaAudioContext(validAudios, enableStudioEQ);
    } catch (decodeError) {
      console.warn(
        "[StreamingTTSGenerator] AudioContext decode failed, using manual PCM extraction:",
        decodeError,
      );
      return this.combineViaPcmExtraction(validAudios);
    }
  }

  /**
   * Combine via AudioContext decode/re-encode.
   */
  private async combineViaAudioContext(
    validAudios: GeneratedAudio[],
    enableStudioEQ: boolean,
  ): Promise<Blob> {
    const audioContext = new AudioContext();
    const audioBuffers: AudioBuffer[] = [];

    for (const audio of validAudios) {
      const arrayBuffer = await audio.blob!.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(audioBuffer);
    }

    const sampleRate = audioBuffers[0]?.sampleRate || 24000;
    const podcastFormat =
      this.currentScript?.metadata?.format === "solo" ? "solo" : "dialogue";
    const pauseFrames = validAudios.map((audio, index) =>
      Math.round(
        (podcastPauseMilliseconds(
          audio.speaker,
          validAudios[index + 1]?.speaker,
          podcastFormat,
          this.currentConfig.pauseBetweenSegments,
        ) /
          1000) *
          sampleRate,
      ),
    );
    const totalLength = audioBuffers.reduce(
      (sum, buffer, index) => sum + buffer.length + pauseFrames[index],
      0,
    );
    const numChannels = enableStudioEQ
      ? 2
      : audioBuffers[0]?.numberOfChannels || 1;

    if (enableStudioEQ) {
      // Use OfflineAudioContext to render high-quality mastered stereo audio
      const offlineCtx = new OfflineAudioContext(
        numChannels,
        totalLength,
        sampleRate,
      );

      // Setup EQ / Master FX: Compressor
      const compressor = offlineCtx.createDynamicsCompressor();
      compressor.threshold.value = -20; // dB
      compressor.knee.value = 30; // dB
      compressor.ratio.value = 3; // 3:1 ratio
      compressor.attack.value = 0.003; // 3ms
      compressor.release.value = 0.25; // 250ms
      compressor.connect(offlineCtx.destination);

      // Setup EQ: highpass and presence boost peaking filter
      const highPass = offlineCtx.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      const peakingEQ = offlineCtx.createBiquadFilter();
      peakingEQ.type = "peaking";
      peakingEQ.frequency.value = 3000;
      peakingEQ.Q.value = 1.0;
      peakingEQ.gain.value = 2.0;

      highPass.connect(peakingEQ);
      peakingEQ.connect(compressor);

      // Map and position buffers on the timeline
      let currentSampleOffset = 0;
      const host1 = this.currentScript?.metadata?.host1Name || "Alex";
      const host2 = this.currentScript?.metadata?.host2Name || "Sarah";

      for (let i = 0; i < audioBuffers.length; i++) {
        const buffer = audioBuffers[i];
        const info = validAudios[i];
        const speaker = info.speaker;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;

        // Stereo panning
        const panner = offlineCtx.createStereoPanner();
        let panVal = 0;
        if (podcastFormat === "dialogue") {
          if (speaker === host1) {
            panVal = -0.15;
          } else if (speaker === host2) {
            panVal = 0.15;
          }
        }
        panner.pan.value = panVal;

        const startTime = currentSampleOffset / sampleRate;
        const endTime = startTime + buffer.duration;
        const fadeSeconds = Math.min(0.012, buffer.duration / 3);
        const gain = offlineCtx.createGain();
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(1, startTime + fadeSeconds);
        gain.gain.setValueAtTime(
          1,
          Math.max(startTime + fadeSeconds, endTime - fadeSeconds),
        );
        gain.gain.linearRampToValueAtTime(0, endTime);

        source.connect(gain);
        gain.connect(panner);
        panner.connect(highPass);

        source.start(startTime);

        currentSampleOffset += buffer.length + pauseFrames[i];
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = this.audioBufferToWav(renderedBuffer);
      console.log(
        `[StreamingTTSGenerator] Mastered via OfflineAudioContext: ${wavBlob.size} bytes`,
      );
      await audioContext.close();
      return wavBlob;
    } else {
      const combinedBuffer = audioContext.createBuffer(
        numChannels,
        totalLength,
        sampleRate,
      );

      let offset = 0;
      for (let index = 0; index < audioBuffers.length; index += 1) {
        const buffer = audioBuffers[index];
        for (let channel = 0; channel < numChannels; channel++) {
          const dest = combinedBuffer.getChannelData(channel);
          const src = buffer.getChannelData(
            Math.min(channel, buffer.numberOfChannels - 1),
          );
          dest.set(src, offset);
        }
        offset += buffer.length + pauseFrames[index];
      }

      const wavBlob = this.audioBufferToWav(combinedBuffer);
      console.log(
        `[StreamingTTSGenerator] Combined flat: ${wavBlob.size} bytes`,
      );
      await audioContext.close();
      return wavBlob;
    }
  }

  /**
   * Fallback: manually parse WAV headers, concatenate PCM data,
   * write a single new WAV header.
   */
  private async combineViaPcmExtraction(
    validAudios: GeneratedAudio[],
  ): Promise<Blob> {
    const format = this.currentScript?.metadata?.format === "solo" ? "solo" : "dialogue";
    const parts = [];
    for (let index = 0; index < validAudios.length; index++) {
      const audio = validAudios[index];
      if (!audio.blob) throw new Error("A generated podcast segment is missing");
      parts.push({
        buffer: await audio.blob.arrayBuffer(),
        pauseAfterMs: podcastPauseMilliseconds(audio.speaker, validAudios[index + 1]?.speaker, format, this.currentConfig.pauseBetweenSegments),
      });
    }
    return new Blob([concatenatePcmWav(parts)], { type: "audio/wav" });
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, buffer.getChannelData(channel)[i]),
        );
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  reset(): void {
    // A reset requests cancellation but does not release the one-run guard
    // until the outstanding provider promise has actually settled.
    if (this.isGenerating) this.cancel();
    else this.stopPlayback();
    this.discardGeneratedAudio();
    this.currentScript = null;
  }

  private optimizeSegments(segments: PodcastSegment[]): PodcastSegment[] {
    const optimized: PodcastSegment[] = [];
    let current: PodcastSegment | null = null;

    for (const seg of segments) {
      if (!current) {
        current = { ...seg };
        continue;
      }

      if (
        current.speaker === seg.speaker &&
        current.text.length + seg.text.length < 300
      ) {
        current.text += " " + seg.text;
      } else {
        optimized.push(current);
        current = { ...seg };
      }
    }

    if (current) {
      optimized.push(current);
    }

    console.log(`Optimized ${segments.length} segments to ${optimized.length}`);
    return optimized;
  }

  private async synthesizeWithRetry(
    workerManager: TTSWorkerManager,
    text: string,
    voice: string,
    speed: number,
    onProgress: (message: string, percentage: number) => void,
    onRetry: () => void,
  ): Promise<SynthesisResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await workerManager.synthesize(text, voice, speed, onProgress);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          onRetry();
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Audio synthesis failed after retrying");
  }

  private discardGeneratedAudio(): void {
    for (const audio of this.generatedAudios) {
      if (
        audio.url.startsWith("blob:") &&
        typeof URL !== "undefined" &&
        typeof URL.revokeObjectURL === "function"
      ) {
        URL.revokeObjectURL(audio.url);
      }
    }
    this.generatedAudios = [];
  }

  private estimateDuration(text: string): number {
    const words = text.split(/\s+/).length;
    return (words / 150) * 60;
  }

  private estimateRemainingTime(
    startTime: number,
    completedSegments: number,
    totalSegments: number,
  ): number {
    if (completedSegments === 0) return 0;

    const elapsed = (Date.now() - startTime) / 1000;
    const avgTimePerSegment = elapsed / completedSegments;
    const remaining = totalSegments - completedSegments;

    return Math.round(avgTimePerSegment * remaining);
  }

  private cleanup(
    reason: "cancelled" | "error",
    onProgress: ProgressCallback,
  ): void {
    if (reason === "cancelled") this.discardGeneratedAudio();
    this.isGenerating = false;
    onProgress({
      phase: reason,
      currentSegment: 0,
      totalSegments: 0,
      percentage: 0,
      message:
        reason === "cancelled" ? "Generation cancelled" : "Generation failed",
      canPlay: this.generatedAudios.length > 0,
    });
  }
}

// Singleton
let instance: StreamingTTSGenerator | null = null;

export function getStreamingTTSGenerator(): StreamingTTSGenerator {
  if (!instance) {
    instance = new StreamingTTSGenerator();
  }
  return instance;
}
