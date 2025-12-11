// Ollama Health Check Service
import { OLLAMA_BASE_URL } from './ollamaService';

export interface OllamaHealthStatus {
  isAvailable: boolean;
  models: string[];
  error?: string;
  checkedAt: Date;
}

/**
 * Check if Ollama service is running and available
 */
export async function checkOllamaHealth(): Promise<OllamaHealthStatus> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(\\/api/tags\, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        isAvailable: false,
        models: [],
        error: \Ollama responded with status \\,
        checkedAt: new Date(),
      };
    }

    const data = await response.json();
    const models = data.models?.map((m: any) => m.name) || [];

    return {
      isAvailable: true,
      models,
      checkedAt: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      isAvailable: false,
      models: [],
      error: errorMessage.includes('abort') 
        ? 'Ollama connection timeout (is Ollama running?)'
        : \Failed to connect to Ollama: \\,
      checkedAt: new Date(),
    };
  }
}

/**
 * Continuous health monitoring with callbacks
 */
export class OllamaHealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private currentStatus: OllamaHealthStatus | null = null;
  private listeners: Array<(status: OllamaHealthStatus) => void> = [];

  constructor(private checkIntervalMs: number = 30000) {} // Check every 30s

  /**
   * Start monitoring Ollama health
   */
  async start(): Promise<void> {
    // Do initial check
    await this.check();

    // Start periodic checks
    this.intervalId = setInterval(() => {
      this.check();
    }, this.checkIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Perform health check and notify listeners
   */
  private async check(): Promise<void> {
    const status = await checkOllamaHealth();
    this.currentStatus = status;

    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Health monitor listener error:', error);
      }
    });
  }

  /**
   * Add status change listener
   */
  addListener(callback: (status: OllamaHealthStatus) => void): () => void {
    this.listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Get current status
   */
  getStatus(): OllamaHealthStatus | null {
    return this.currentStatus;
  }

  /**
   * Force immediate check
   */
  async forceCheck(): Promise<OllamaHealthStatus> {
    await this.check();
    return this.currentStatus!;
  }
}

// Export singleton instance
export const ollamaHealthMonitor = new OllamaHealthMonitor();
