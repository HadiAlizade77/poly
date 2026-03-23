// ─── Feed Module Interface ──────────────────────────────────────────────────

export interface NormalizedDataPoint {
  source: string;
  data_type: string;
  symbol: string;
  timestamp: Date;
  value: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FeedHealth {
  connected: boolean;
  lastMessageAt: Date | null;
  errorCount: number;
  status: 'healthy' | 'degraded' | 'disconnected';
}

export interface FeedModule {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (data: NormalizedDataPoint) => void): void;
  health(): FeedHealth;
  isEnabled(): boolean;
}

/**
 * Base class for feeds that provides common health tracking and handler management.
 */
export abstract class BaseFeed implements FeedModule {
  abstract readonly name: string;

  protected handlers: Array<(data: NormalizedDataPoint) => void> = [];
  protected _health: FeedHealth = {
    connected: false,
    lastMessageAt: null,
    errorCount: 0,
    status: 'disconnected',
  };

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isEnabled(): boolean;

  onData(handler: (data: NormalizedDataPoint) => void): void {
    this.handlers.push(handler);
  }

  health(): FeedHealth {
    return { ...this._health };
  }

  protected emit(data: NormalizedDataPoint): void {
    this._health.lastMessageAt = new Date();
    this._health.status = 'healthy';
    for (const handler of this.handlers) {
      try {
        handler(data);
      } catch {
        // Handler errors should not crash the feed
      }
    }
  }

  protected markConnected(): void {
    this._health.connected = true;
    this._health.status = 'healthy';
    this._health.errorCount = 0;
  }

  protected markDisconnected(): void {
    this._health.connected = false;
    this._health.status = 'disconnected';
  }

  protected markError(): void {
    this._health.errorCount++;
    if (this._health.errorCount >= 5) {
      this._health.status = 'degraded';
    }
  }
}
