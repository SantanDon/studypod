import { generateEmbeddings } from "../ai/ollamaService";

interface CacheEntry {
  embedding: number[];
  timestamp: number;
  hits: number;
}

class EmbeddingCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize = 1000;
  private ttl = 24 * 60 * 60 * 1000;

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  async getEmbedding(text: string): Promise<number[]> {
    const key = this.hashText(text);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      cached.hits++;
      console.log(`✓ Cache hit for embedding (${this.cache.size} cached)`);
      return cached.embedding;
    }

    console.log(`⚠ Cache miss - generating embedding...`);
    const embedding = await generateEmbeddings(text);

    if (this.cache.size >= this.maxSize) {
      let leastUsed = null;
      let minHits = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.hits < minHits) {
          minHits = v.hits;
          leastUsed = k;
        }
      }
      if (leastUsed) this.cache.delete(leastUsed);
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now(),
      hits: 1
    });

    return embedding;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      totalHits: Array.from(this.cache.values()).reduce((sum, v) => sum + v.hits, 0)
    };
  }
}

export const embeddingCache = new EmbeddingCache();