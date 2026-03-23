/**
 * Polymarket CLOB WebSocket client.
 *
 * Live mode  — connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
 *              Requires Node 21+ (built-in WebSocket) or --experimental-websocket on Node 20.
 *
 * Demo mode  — generates synthetic price-change events via setInterval so the
 *              scanner works end-to-end without any real credentials.
 *
 * Usage:
 *   const ws = new PolymarketWebSocket({ demoMode: true });
 *   ws.on('priceChange', (event) => { ... });
 *   ws.subscribe(['token-id-1', 'token-id-2']);
 *   ws.connect();
 */
import { EventEmitter } from 'events';
import logger from '../../config/logger.js';
import type { WsMarketEvent, WsPriceChangeEvent } from './types.js';

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const RECONNECT_BASE_MS  = 2_000;
const RECONNECT_MAX_MS   = 60_000;
const STABLE_AFTER_MS    = 30_000;  // only reset backoff after connection lives this long
const MAX_RAPID_FAILURES = 5;       // switch to demo after N rapid disconnects
const DEMO_TICK_MS       = 5_000;

export declare interface PolymarketWebSocket {
  on(event: 'priceChange',  listener: (e: WsPriceChangeEvent) => void): this;
  on(event: 'connect',      listener: () => void): this;
  on(event: 'disconnect',   listener: (reason: string) => void): this;
  on(event: 'error',        listener: (err: Error) => void): this;
}

export class PolymarketWebSocket extends EventEmitter {
  private readonly demoMode: boolean;
  private subscribedTokens = new Set<string>();
  private socket: WebSocket | null = null;
  private demoTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private rapidFailures = 0;
  private connectTime = 0;
  private stopped = false;

  constructor(options: { demoMode?: boolean } = {}) {
    super();
    this.demoMode = options.demoMode ?? false;
  }

  /** Subscribe to price updates for the given token IDs. */
  subscribe(tokenIds: string[]): void {
    for (const id of tokenIds) this.subscribedTokens.add(id);

    if (!this.demoMode && this.socket?.readyState === 1 /* OPEN */) {
      this.sendSubscribe(tokenIds);
    }
  }

  /** Unsubscribe from token IDs. */
  unsubscribe(tokenIds: string[]): void {
    for (const id of tokenIds) this.subscribedTokens.delete(id);
  }

  /** Open the connection (or start the demo timer). */
  connect(): void {
    this.stopped = false;
    if (this.demoMode) {
      this.startDemoTicker();
    } else {
      this.openSocket();
    }
  }

  /** Tear down the connection cleanly. */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.demoMode) {
      this.stopDemoTicker();
    } else {
      this.socket?.close(1000, 'client disconnect');
      this.socket = null;
    }
  }

  // ─── Live WebSocket ─────────────────────────────────────────────────────────

  private openSocket(): void {
    if (typeof WebSocket === 'undefined') {
      logger.warn(
        'PolymarketWebSocket: global WebSocket not available (requires Node 21+ or --experimental-websocket). ' +
        'Falling back to polling-only mode.',
      );
      return;
    }

    try {
      this.socket = new WebSocket(WS_URL);
    } catch (err) {
      logger.error('PolymarketWebSocket: failed to create WebSocket', {
        error: (err as Error).message,
      });
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      logger.info('PolymarketWebSocket: connected');
      this.connectTime = Date.now();
      this.emit('connect');

      if (this.subscribedTokens.size > 0) {
        this.sendSubscribe([...this.subscribedTokens]);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const messages = JSON.parse(event.data as string) as WsMarketEvent[];
        const events = Array.isArray(messages) ? messages : [messages];
        for (const msg of events) {
          if (msg.event_type === 'price_change') {
            this.emit('priceChange', msg);
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    this.socket.onerror = (event) => {
      logger.warn('PolymarketWebSocket: socket error', { event: String(event) });
      this.emit('error', new Error('WebSocket error'));
    };

    this.socket.onclose = (event) => {
      const uptime = Date.now() - this.connectTime;
      logger.info('PolymarketWebSocket: disconnected', { code: event.code, reason: event.reason, uptimeMs: uptime });
      this.emit('disconnect', event.reason);
      this.socket = null;

      if (this.stopped) return;

      // If connection was stable, reset backoff and failure count
      if (uptime >= STABLE_AFTER_MS) {
        this.reconnectDelay = RECONNECT_BASE_MS;
        this.rapidFailures = 0;
        this.scheduleReconnect();
        return;
      }

      // Rapid failure — connection dropped almost immediately
      this.rapidFailures++;
      if (this.rapidFailures >= MAX_RAPID_FAILURES) {
        logger.warn(
          'PolymarketWebSocket: too many rapid disconnects, falling back to demo mode',
          { failures: this.rapidFailures },
        );
        this.rapidFailures = 0;
        this.reconnectDelay = RECONNECT_BASE_MS;
        this.startDemoTicker();
        return;
      }

      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    logger.info('PolymarketWebSocket: reconnecting', { delayMs: this.reconnectDelay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private sendSubscribe(tokenIds: string[]): void {
    if (this.socket?.readyState !== 1) return;
    this.socket.send(
      JSON.stringify({ type: 'subscribe', channel: 'market', markets: tokenIds }),
    );
  }

  // ─── Demo mode ──────────────────────────────────────────────────────────────

  private startDemoTicker(): void {
    this.stopDemoTicker();
    logger.info('PolymarketWebSocket: demo mode — emitting synthetic price events', {
      tickMs: DEMO_TICK_MS,
    });
    this.emit('connect');
    this.demoTimer = setInterval(() => this.emitDemoEvent(), DEMO_TICK_MS);
    this.demoTimer.unref();
  }

  private stopDemoTicker(): void {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }

  private emitDemoEvent(): void {
    const tokens = [...this.subscribedTokens];
    if (tokens.length === 0) return;

    const tokenId = tokens[Math.floor(Math.random() * tokens.length)];
    const price   = (0.3 + Math.random() * 0.4).toFixed(4); // 0.30 – 0.70

    const event: WsPriceChangeEvent = {
      event_type: 'price_change',
      asset_id:   tokenId,
      price,
      side:       Math.random() > 0.5 ? 'BUY' : 'SELL',
      size:       String(10 + Math.floor(Math.random() * 500)),
      market:     `demo-market-${tokenId.slice(0, 8)}`,
      outcome:    tokenId.endsWith('-yes') ? 'Yes' : 'No',
      timestamp:  new Date().toISOString(),
    };

    this.emit('priceChange', event);
  }
}
