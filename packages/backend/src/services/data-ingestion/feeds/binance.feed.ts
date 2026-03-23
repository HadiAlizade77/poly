// ─── Binance WebSocket Feed ─────────────────────────────────────────────────

import WebSocket from 'ws';
import logger from '../../../config/logger.js';
import { BaseFeed } from '../feed.interface.js';
import { BarBuilder } from '../bar-builder.js';
import { SessionVolumeNormalizer } from '../session-volume.js';

const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';
const SYMBOLS = ['btcusdt', 'ethusdt'] as const;

interface BinanceTradeMsg {
  e: 'trade';
  s: string; // symbol
  p: string; // price
  q: string; // quantity
  T: number; // trade time ms
}

interface BinanceKlineMsg {
  e: 'kline';
  s: string;
  k: {
    t: number; // kline start time
    T: number; // kline close time
    s: string;
    i: string; // interval
    o: string; // open
    h: string; // high
    l: string; // low
    c: string; // close
    v: string; // volume
    x: boolean; // is closed
  };
}

type BinanceMessage = BinanceTradeMsg | BinanceKlineMsg;

const MOCK_INTERVAL_MS = 2_000; // mock trade every 2s

export class BinanceFeed extends BaseFeed {
  readonly name = 'binance';

  private ws: WebSocket | null = null;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private mockMode = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Per-symbol bar builders and volume normalizers
  readonly barBuilders: Record<string, BarBuilder> = {};
  readonly volumeNormalizers: Record<string, SessionVolumeNormalizer> = {};

  constructor() {
    super();
    for (const sym of SYMBOLS) {
      this.barBuilders[sym] = new BarBuilder();
      this.volumeNormalizers[sym] = new SessionVolumeNormalizer();
    }
  }

  isEnabled(): boolean {
    return true; // Always enabled — falls back to mock mode
  }

  async connect(): Promise<void> {
    try {
      await this.connectWebSocket();
    } catch {
      logger.warn('Binance WS connection failed — switching to mock mode');
      this.startMockMode();
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.markDisconnected();
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const streams = SYMBOLS.map((s) => `${s}@trade/${s}@kline_1m`).join('/');
      const url = `${BINANCE_WS_BASE}/${streams}`;

      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.close();
        reject(new Error('Binance WS connection timeout'));
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.mockMode = false;
        this.markConnected();
        logger.info('Binance WebSocket connected', { symbols: SYMBOLS });
        resolve();
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as BinanceMessage;
          this.handleMessage(msg);
        } catch {
          this.markError();
        }
      });

      ws.on('close', () => {
        this.markDisconnected();
        if (!this.mockMode) {
          logger.warn('Binance WS closed — reconnecting in 5s');
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.markError();
        logger.error('Binance WS error', { error: err.message });
        reject(err);
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket().catch(() => {
        logger.warn('Binance reconnect failed — switching to mock mode');
        this.startMockMode();
      });
    }, 5_000);
  }

  private handleMessage(msg: BinanceMessage): void {
    if (msg.e === 'trade') {
      this.handleTrade(msg);
    } else if (msg.e === 'kline') {
      this.handleKline(msg);
    }
  }

  private handleTrade(msg: BinanceTradeMsg): void {
    const symbol = msg.s.toLowerCase();
    const price = parseFloat(msg.p);
    const quantity = parseFloat(msg.q);
    const timestamp = new Date(msg.T);

    // Feed to bar builder
    this.barBuilders[symbol]?.addTrade(price, quantity, timestamp);

    // Feed to volume normalizer
    this.volumeNormalizers[symbol]?.addVolume(quantity * price, timestamp);

    this.emit({
      source: 'binance',
      data_type: 'trade',
      symbol,
      timestamp,
      value: { price, quantity, quote_volume: price * quantity },
      metadata: { mock: false },
    });
  }

  private handleKline(msg: BinanceKlineMsg): void {
    const k = msg.k;
    if (!k.x) return; // Only emit completed klines

    const symbol = k.s.toLowerCase();

    this.emit({
      source: 'binance',
      data_type: 'kline_1m',
      symbol,
      timestamp: new Date(k.t),
      value: {
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        interval: k.i,
      },
      metadata: { closed: k.x, mock: false },
    });
  }

  // ─── Mock Mode ──────────────────────────────────────────────────────────────

  private startMockMode(): void {
    this.mockMode = true;
    this.markConnected();
    logger.info('Binance feed running in MOCK mode');

    const mockPrices: Record<string, number> = {
      btcusdt: 65_000,
      ethusdt: 3_400,
    };

    this.mockTimer = setInterval(() => {
      const now = new Date();

      for (const symbol of SYMBOLS) {
        // Random walk
        const drift = (Math.random() - 0.5) * 0.002; // ±0.1%
        mockPrices[symbol] *= 1 + drift;
        const price = mockPrices[symbol];
        const quantity = Math.random() * (symbol === 'btcusdt' ? 0.5 : 5);

        this.barBuilders[symbol]?.addTrade(price, quantity, now);
        this.volumeNormalizers[symbol]?.addVolume(quantity * price, now);

        this.emit({
          source: 'binance',
          data_type: 'trade',
          symbol,
          timestamp: now,
          value: { price, quantity, quote_volume: price * quantity },
          metadata: { mock: true },
        });
      }
    }, MOCK_INTERVAL_MS);
  }
}
