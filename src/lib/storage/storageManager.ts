console.log("DEBUG: storageManager.ts executing");
/**
 * Storage Manager - Handles localStorage size management, compression, and cleanup
 */

// LZ-based compression using native CompressionStream API (fallback to simple encoding)
const COMPRESSION_PREFIX = "LZ:";

export interface StorageStats {
  totalBytes: number;
  totalMB: number;
  usedPercentage: number;
  maxBytes: number;
  maxMB: number;
  itemCount: number;
  breakdown: Record<string, { bytes: number; percentage: number }>;
  isNearLimit: boolean;
  availableBytes: number;
}

export interface StorageCleanupResult {
  success: boolean;
  freedBytes: number;
  itemsRemoved: number;
  errors: string[];
}

// Constants
export const STORAGE_CONSTANTS = {
  MAX_STORAGE_BYTES: 4 * 1024 * 1024, // 4MB (leave 1-6MB buffer from typical 5-10MB limit)
  WARNING_THRESHOLD: 0.8, // 80% usage triggers warning
  CRITICAL_THRESHOLD: 0.95, // 95% usage triggers cleanup
  COMPRESSION_THRESHOLD: 1024, // Compress content larger than 1KB
  MANAGED_KEYS: [
    "notebooks",
    "sources",
    "notes",
    "chat_messages",
    "users",
    "passwords",
    "currentUser",
  ],
} as const;

/**
 * Calculate the byte size of a string (UTF-16 encoding in localStorage)
 */
export function getStringByteSize(str: string): number {
  return str.length * 2; // JavaScript strings are UTF-16, 2 bytes per character
}

/**
 * Get the total localStorage usage in bytes
 */
export function getStorageUsage(): number {
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          totalBytes += getStringByteSize(key) + getStringByteSize(value);
        }
      }
    }
  } catch {
    console.error("Failed to calculate storage usage");
  }
  return totalBytes;
}

/**
 * Get detailed storage statistics
 */
export function getStorageStats(): StorageStats {
  const breakdown: Record<string, { bytes: number; percentage: number }> = {};
  let totalBytes = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          const itemBytes = getStringByteSize(key) + getStringByteSize(value);
          breakdown[key] = { bytes: itemBytes, percentage: 0 };
          totalBytes += itemBytes;
        }
      }
    }

    // Calculate percentages
    for (const key in breakdown) {
      breakdown[key].percentage =
        totalBytes > 0 ? (breakdown[key].bytes / totalBytes) * 100 : 0;
    }
  } catch {
    console.error("Failed to get storage stats");
  }

  const usedPercentage = totalBytes / STORAGE_CONSTANTS.MAX_STORAGE_BYTES;

  return {
    totalBytes,
    totalMB: totalBytes / (1024 * 1024),
    usedPercentage,
    maxBytes: STORAGE_CONSTANTS.MAX_STORAGE_BYTES,
    maxMB: STORAGE_CONSTANTS.MAX_STORAGE_BYTES / (1024 * 1024),
    itemCount: localStorage.length,
    breakdown,
    isNearLimit: usedPercentage >= STORAGE_CONSTANTS.WARNING_THRESHOLD,
    availableBytes: Math.max(
      0,
      STORAGE_CONSTANTS.MAX_STORAGE_BYTES - totalBytes
    ),
  };
}

/**
 * Check if a given content size would exceed storage limits
 */
export function wouldExceedLimit(contentBytes: number): boolean {
  const currentUsage = getStorageUsage();
  return currentUsage + contentBytes > STORAGE_CONSTANTS.MAX_STORAGE_BYTES;
}

/**
 * Validate if content can be stored (returns error message or null if valid)
 */
export function validateStorageSize(
  key: string,
  content: string
): { valid: boolean; error?: string; suggestedAction?: string } {
  const contentBytes = getStringByteSize(content);
  const currentUsage = getStorageUsage();
  const existingItemSize = getItemSize(key);
  const netIncrease = contentBytes - existingItemSize;

  if (currentUsage + netIncrease > STORAGE_CONSTANTS.MAX_STORAGE_BYTES) {
    const availableBytes = STORAGE_CONSTANTS.MAX_STORAGE_BYTES - currentUsage + existingItemSize;
    return {
      valid: false,
      error: `Storage limit exceeded. Content size: ${formatBytes(contentBytes)}, Available: ${formatBytes(availableBytes)}`,
      suggestedAction:
        "Try cleaning up old data or reducing content size. Use cleanupOldData() to free space.",
    };
  }

  if (
    currentUsage + netIncrease >
    STORAGE_CONSTANTS.MAX_STORAGE_BYTES * STORAGE_CONSTANTS.WARNING_THRESHOLD
  ) {
    return {
      valid: true,
      error: `Warning: Storage is at ${((currentUsage + netIncrease) / STORAGE_CONSTANTS.MAX_STORAGE_BYTES * 100).toFixed(1)}% capacity`,
      suggestedAction: "Consider cleaning up unused data soon.",
    };
  }

  return { valid: true };
}

/**
 * Get size of a specific localStorage item
 */
export function getItemSize(key: string): number {
  try {
    const value = localStorage.getItem(key);
    if (value) {
      return getStringByteSize(key) + getStringByteSize(value);
    }
  } catch {
    // Item doesn't exist
  }
  return 0;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Compress a string using LZ-style compression
 * Uses a simple but effective run-length + dictionary approach
 */
export function compressString(input: string): string {
  if (input.length < STORAGE_CONSTANTS.COMPRESSION_THRESHOLD) {
    return input; // Don't compress small content
  }

  try {
    // Simple LZ-style compression using base64 + dictionary
    const compressed = lzCompress(input);
    
    // Only use compression if it actually saves space
    if (compressed.length < input.length * 0.9) {
      return COMPRESSION_PREFIX + compressed;
    }
    return input;
  } catch {
    return input; // Return original on error
  }
}

/**
 * Decompress a string if it was compressed
 */
export function decompressString(input: string): string {
  if (!input.startsWith(COMPRESSION_PREFIX)) {
    return input;
  }

  try {
    return lzDecompress(input.slice(COMPRESSION_PREFIX.length));
  } catch {
    console.error("Failed to decompress string");
    return input; // Return as-is on error
  }
}

/**
 * Check if a string is compressed
 */
export function isCompressed(input: string): boolean {
  return input.startsWith(COMPRESSION_PREFIX);
}

/**
 * Simple LZ compression implementation
 */
function lzCompress(input: string): string {
  if (!input) return "";
  
  const dict: Record<string, number> = {};
  let dictSize = 256;
  const result: number[] = [];
  let w = "";

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const wc = w + c;
    
    if (dict[wc] !== undefined) {
      w = wc;
    } else {
      result.push(w.length === 1 ? w.charCodeAt(0) : dict[w]);
      dict[wc] = dictSize++;
      w = c;
    }
  }

  if (w) {
    result.push(w.length === 1 ? w.charCodeAt(0) : dict[w]);
  }

  // Convert to base64-safe string
  return btoa(result.map(n => String.fromCharCode(n % 65536)).join(""));
}

/**
 * Simple LZ decompression implementation
 */
function lzDecompress(compressed: string): string {
  if (!compressed) return "";

  try {
    const data = atob(compressed).split("").map(c => c.charCodeAt(0));
    
    const dict: string[] = [];
    for (let i = 0; i < 256; i++) {
      dict[i] = String.fromCharCode(i);
    }

    let w = dict[data[0]];
    let result = w;
    
    for (let i = 1; i < data.length; i++) {
      const k = data[i];
      let entry: string;
      
      if (dict[k] !== undefined) {
        entry = dict[k];
      } else if (k === dict.length) {
        entry = w + w[0];
      } else {
        throw new Error("Invalid compressed data");
      }

      result += entry;
      dict.push(w + entry[0]);
      w = entry;
    }

    return result;
  } catch (e) {
    throw new Error("Decompression failed: " + (e instanceof Error ? e.message : "Unknown error"));
  }
}

/**
 * Clean up old/unused data to free storage space
 */
export function cleanupOldData(options?: {
  maxAgeMs?: number;
  keepMinItems?: number;
  dryRun?: boolean;
}): StorageCleanupResult {
  const {
    maxAgeMs = 30 * 24 * 60 * 60 * 1000, // 30 days default
    keepMinItems = 5,
    dryRun = false,
  } = options || {};

  const result: StorageCleanupResult = {
    success: true,
    freedBytes: 0,
    itemsRemoved: 0,
    errors: [],
  };

  const now = Date.now();
  const cutoffDate = new Date(now - maxAgeMs).toISOString();

  try {
    // Clean up old chat messages
    const chatMessages = getAndParseItem<Array<{ id: string; created_at: string; notebook_id: string }>>("chat_messages");
    if (chatMessages.length > keepMinItems) {
      const sortedMessages = [...chatMessages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      const oldMessages = sortedMessages.filter(
        (m, i) => i >= keepMinItems && m.created_at < cutoffDate
      );

      if (oldMessages.length > 0) {
        const originalSize = getItemSize("chat_messages");
        const remainingMessages = chatMessages.filter(
          (m) => !oldMessages.some((om) => om.id === m.id)
        );

        if (!dryRun) {
          localStorage.setItem("chat_messages", JSON.stringify(remainingMessages));
        }

        const newSize = dryRun ? estimateJsonSize(remainingMessages) : getItemSize("chat_messages");
        result.freedBytes += originalSize - newSize;
        result.itemsRemoved += oldMessages.length;
      }
    }

    // Clean up orphaned sources (sources without notebooks)
    const notebooks = getAndParseItem<Array<{ id: string }>>("notebooks");
    const sources = getAndParseItem<Array<{ id: string; notebook_id: string }>>("sources");
    const notebookIds = new Set(notebooks.map((n) => n.id));
    const orphanedSources = sources.filter((s) => !notebookIds.has(s.notebook_id));

    if (orphanedSources.length > 0) {
      const originalSize = getItemSize("sources");
      const remainingSources = sources.filter(
        (s) => !orphanedSources.some((os) => os.id === s.id)
      );

      if (!dryRun) {
        localStorage.setItem("sources", JSON.stringify(remainingSources));
      }

      const newSize = dryRun ? estimateJsonSize(remainingSources) : getItemSize("sources");
      result.freedBytes += originalSize - newSize;
      result.itemsRemoved += orphanedSources.length;
    }

    // Clean up orphaned notes
    const notes = getAndParseItem<Array<{ id: string; notebook_id: string }>>("notes");
    const orphanedNotes = notes.filter((n) => !notebookIds.has(n.notebook_id));

    if (orphanedNotes.length > 0) {
      const originalSize = getItemSize("notes");
      const remainingNotes = notes.filter(
        (n) => !orphanedNotes.some((on) => on.id === n.id)
      );

      if (!dryRun) {
        localStorage.setItem("notes", JSON.stringify(remainingNotes));
      }

      const newSize = dryRun ? estimateJsonSize(remainingNotes) : getItemSize("notes");
      result.freedBytes += originalSize - newSize;
      result.itemsRemoved += orphanedNotes.length;
    }

    // Clean up orphaned chat messages
    const allChatMessages = getAndParseItem<Array<{ id: string; notebook_id: string }>>("chat_messages");
    const orphanedMessages = allChatMessages.filter((m) => !notebookIds.has(m.notebook_id));

    if (orphanedMessages.length > 0) {
      const originalSize = getItemSize("chat_messages");
      const remainingMessages = allChatMessages.filter(
        (m) => !orphanedMessages.some((om) => om.id === m.id)
      );

      if (!dryRun) {
        localStorage.setItem("chat_messages", JSON.stringify(remainingMessages));
      }

      const newSize = dryRun ? estimateJsonSize(remainingMessages) : getItemSize("chat_messages");
      result.freedBytes += originalSize - newSize;
      result.itemsRemoved += orphanedMessages.length;
    }

  } catch (error) {
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown cleanup error"
    );
  }

  return result;
}

/**
 * Helper to parse localStorage item
 */
function getAndParseItem<T>(key: string): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : ([] as unknown as T);
  } catch {
    return [] as unknown as T;
  }
}

/**
 * Estimate JSON string size
 */
function estimateJsonSize(data: unknown): number {
  return getStringByteSize(JSON.stringify(data));
}

/**
 * Attempt to free up space by removing least recently used items
 */
export function emergencyCleanup(targetFreeBytes: number): StorageCleanupResult {
  const result = cleanupOldData({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 }); // 7 days

  if (result.freedBytes < targetFreeBytes) {
    // More aggressive cleanup if needed
    const moreCleanup = cleanupOldData({ maxAgeMs: 1 * 24 * 60 * 60 * 1000, keepMinItems: 2 });
    result.freedBytes += moreCleanup.freedBytes;
    result.itemsRemoved += moreCleanup.itemsRemoved;
    result.errors.push(...moreCleanup.errors);
  }

  return result;
}

/**
 * Safe storage setter with size validation and optional compression
 */
export function safeSetItem(
  key: string,
  value: string,
  options?: { compress?: boolean; forceCleanup?: boolean }
): { success: boolean; error?: string; compressed?: boolean } {
  const { compress = true, forceCleanup = false } = options || {};

  let finalValue = value;
  let wasCompressed = false;

  // Try compression for large content
  if (compress && value.length > STORAGE_CONSTANTS.COMPRESSION_THRESHOLD) {
    const compressed = compressString(value);
    if (compressed.length < value.length) {
      finalValue = compressed;
      wasCompressed = true;
    }
  }

  // Validate size
  const validation = validateStorageSize(key, finalValue);

  if (!validation.valid) {
    if (forceCleanup) {
      const neededBytes = getStringByteSize(finalValue) - getStorageStats().availableBytes;
      const cleanup = emergencyCleanup(neededBytes);
      
      if (cleanup.freedBytes >= neededBytes) {
        // Retry after cleanup
        const retryValidation = validateStorageSize(key, finalValue);
        if (!retryValidation.valid) {
          return { success: false, error: retryValidation.error };
        }
      } else {
        return {
          success: false,
          error: `Could not free enough space. Needed: ${formatBytes(neededBytes)}, Freed: ${formatBytes(cleanup.freedBytes)}`,
        };
      }
    } else {
      return { success: false, error: validation.error };
    }
  }

  try {
    localStorage.setItem(key, finalValue);
    return { success: true, compressed: wasCompressed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save to storage",
    };
  }
}

/**
 * Safe storage getter with automatic decompression
 */
export function safeGetItem(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value && isCompressed(value)) {
      return decompressString(value);
    }
    return value;
  } catch {
    return null;
  }
}

export const storageManager = {
  getStorageUsage,
  getStorageStats,
  validateStorageSize,
  wouldExceedLimit,
  getItemSize,
  formatBytes,
  compressString,
  decompressString,
  isCompressed,
  cleanupOldData,
  emergencyCleanup,
  safeSetItem,
  safeGetItem,
  CONSTANTS: STORAGE_CONSTANTS,
};
