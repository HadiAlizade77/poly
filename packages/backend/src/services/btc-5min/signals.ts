/**
 * BTC 5-Min Signal Generator
 *
 * Computes momentum, RSI, volume signals from Binance 1-min candle data
 * stored in the external_data_points table.
 */
import prisma from '../../config/database.js';
import logger from '../../config/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface BtcSignals {
  // Momentum
  momentum_1m: number;   // % change last 1 min
  momentum_3m: number;   // % change last 3 min
  momentum_5m: number;   // % change last 5 min
  trend: 'up' | 'down' | 'flat';

  // RSI (14-period on 1-min candles)
  rsi: number;           // 0-100
  rsi_signal: 'overbought' | 'oversold' | 'neutral';

  // Volume
  volume_ratio: number;  // current volume / avg volume (last 20 candles)
  volume_surge: boolean; // ratio > 2.0

  // Price action
  current_price: number;
  vwap: number;          // volume-weighted avg price last 20 candles
  price_vs_vwap: 'above' | 'below';

  // Composite
  direction_score: number;  // -100 to +100 (negative=down, positive=up)
  confidence: number;       // 0-1
  suggested_side: 'YES' | 'NO' | null;  // YES=up, NO=down, null=skip

  candle_count: number;
  latest_timestamp: Date;
}

// ─── RSI computation ─────────────────────────────────────────────────────────

function computeRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50; // not enough data — neutral

  let gains = 0;
  let losses = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder smoothing for remaining candles
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain  = delta > 0 ? delta : 0;
    const loss  = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── Clamp helper ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function computeSignals(): Promise<BtcSignals | null> {
  // Query the last 30 1-min candles from the DB, newest first
  const rows = await prisma.externalDataPoint.findMany({
    where: {
      source:    'binance',
      data_type: 'kline_1m',
      symbol:    'btcusdt',
    },
    orderBy: { timestamp: 'desc' },
    take: 30,
  });

  if (rows.length < 5) {
    logger.warn('BtcSignals: not enough candle data', { count: rows.length });
    return null;
  }

  // Parse candles — rows are newest first, reverse to oldest-first for calculations
  const candles: Candle[] = rows
    .map((row) => {
      const v = row.value as Record<string, unknown>;
      return {
        open:      Number(v.open  ?? v.o ?? 0),
        high:      Number(v.high  ?? v.h ?? 0),
        low:       Number(v.low   ?? v.l ?? 0),
        close:     Number(v.close ?? v.c ?? 0),
        volume:    Number(v.volume ?? v.v ?? 0),
        timestamp: new Date(row.timestamp),
      } satisfies Candle;
    })
    .filter((c) => c.close > 0)
    .reverse(); // oldest → newest

  if (candles.length < 5) {
    logger.warn('BtcSignals: insufficient valid candles after parse', { count: candles.length });
    return null;
  }

  const latest = candles[candles.length - 1];
  const current_price = latest.close;

  // ── Momentum ──────────────────────────────────────────────────────────────
  const momentum = (n: number): number => {
    if (candles.length <= n) return 0;
    const ref = candles[candles.length - 1 - n].close;
    return ref > 0 ? ((current_price - ref) / ref) * 100 : 0;
  };

  const momentum_1m = momentum(1);
  const momentum_3m = momentum(3);
  const momentum_5m = momentum(5);

  let trend: 'up' | 'down' | 'flat';
  if (momentum_3m > 0.1)       trend = 'up';
  else if (momentum_3m < -0.1) trend = 'down';
  else                          trend = 'flat';

  // ── RSI ───────────────────────────────────────────────────────────────────
  const closes = candles.map((c) => c.close);
  const rsi = computeRsi(closes, 14);

  let rsi_signal: 'overbought' | 'oversold' | 'neutral';
  if (rsi > 70)      rsi_signal = 'overbought';
  else if (rsi < 30) rsi_signal = 'oversold';
  else               rsi_signal = 'neutral';

  // ── Volume ────────────────────────────────────────────────────────────────
  const last20Candles = candles.slice(-20);
  const avgVolume = last20Candles.reduce((s, c) => s + c.volume, 0) / last20Candles.length;
  const volume_ratio = avgVolume > 0 ? latest.volume / avgVolume : 1;
  const volume_surge = volume_ratio > 2.0;

  // ── VWAP (last 20 candles) ────────────────────────────────────────────────
  const totalVolume    = last20Candles.reduce((s, c) => s + c.volume, 0);
  const totalPriceVol  = last20Candles.reduce((s, c) => s + c.close * c.volume, 0);
  const vwap           = totalVolume > 0 ? totalPriceVol / totalVolume : current_price;
  const price_vs_vwap: 'above' | 'below' = current_price >= vwap ? 'above' : 'below';

  // ── Direction score ────────────────────────────────────────────────────────
  // momentum_3m weight 40%: clamp(momentum_3m * 20, -40, 40)
  const momentumContrib = clamp(momentum_3m * 20, -40, 40);

  // RSI weight 30%: oversold → +30, overbought → -30, neutral → 0
  const rsiContrib = rsi_signal === 'oversold' ? 30 : rsi_signal === 'overbought' ? -30 : 0;

  // Volume surge + momentum alignment weight 15%
  const volumeContrib = volume_surge && momentum_3m > 0
    ? 15
    : volume_surge && momentum_3m < 0
      ? -15
      : 0;

  // Price vs VWAP weight 15%
  const vwapContrib = price_vs_vwap === 'above' ? 15 : -15;

  const direction_score = clamp(
    momentumContrib + rsiContrib + volumeContrib + vwapContrib,
    -100,
    100,
  );

  const confidence = Math.abs(direction_score) / 100;

  let suggested_side: 'YES' | 'NO' | null;
  if (direction_score > 20)       suggested_side = 'YES';
  else if (direction_score < -20) suggested_side = 'NO';
  else                            suggested_side = null;

  return {
    momentum_1m,
    momentum_3m,
    momentum_5m,
    trend,
    rsi,
    rsi_signal,
    volume_ratio,
    volume_surge,
    current_price,
    vwap,
    price_vs_vwap,
    direction_score,
    confidence,
    suggested_side,
    candle_count: candles.length,
    latest_timestamp: latest.timestamp,
  };
}
