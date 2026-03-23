import { describe, it, expect, beforeEach } from 'vitest';
import { BarBuilder } from '../../../src/services/data-ingestion/bar-builder.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a Date at a fixed UTC time (minutes within an hour offset) */
function t(baseMs: number, offsetMs = 0): Date {
  return new Date(baseMs + offsetMs);
}

// Fixed base times aligned to bar boundaries
const BASE_1M = new Date('2025-01-01T00:00:00.000Z').getTime(); // start of a 1m bar
const BASE_5M = new Date('2025-01-01T00:00:00.000Z').getTime(); // start of a 5m bar
const BASE_1H = new Date('2025-01-01T00:00:00.000Z').getTime(); // start of a 1h bar

const MS_1M = 60_000;
const MS_5M = 300_000;
const MS_1H = 3_600_000;

// ─── In-progress bars ─────────────────────────────────────────────────────────

describe('BarBuilder – in-progress bar', () => {
  let builder: BarBuilder;

  beforeEach(() => {
    builder = new BarBuilder();
  });

  it('getCompletedBars returns empty array before any window closes', () => {
    builder.addTrade(0.65, 100, new Date(BASE_1M));
    expect(builder.getCompletedBars('1m')).toHaveLength(0);
    expect(builder.getCompletedBars('5m')).toHaveLength(0);
    expect(builder.getCompletedBars('1h')).toHaveLength(0);
  });

  it('getCurrentBar returns the in-progress bar', () => {
    builder.addTrade(0.65, 100, new Date(BASE_1M));
    const bar = builder.getCurrentBar('1m');

    expect(bar).not.toBeNull();
    expect(bar!.open).toBe(0.65);
    expect(bar!.close).toBe(0.65);
    expect(bar!.high).toBe(0.65);
    expect(bar!.low).toBe(0.65);
    expect(bar!.volume).toBe(100);
    expect(bar!.trades).toBe(1);
  });

  it('getCurrentBar returns null when no trade added', () => {
    expect(builder.getCurrentBar('1m')).toBeNull();
  });
});

// ─── OHLCV accuracy ───────────────────────────────────────────────────────────

describe('BarBuilder – OHLCV values', () => {
  let builder: BarBuilder;

  beforeEach(() => {
    builder = new BarBuilder();
  });

  it('accumulates multiple trades within the same 1m bar', () => {
    builder.addTrade(0.60, 100, new Date(BASE_1M));
    builder.addTrade(0.65, 200, new Date(BASE_1M + 10_000)); // +10s, same bar
    builder.addTrade(0.55, 150, new Date(BASE_1M + 30_000)); // +30s, same bar

    const bar = builder.getCurrentBar('1m');
    expect(bar).not.toBeNull();
    expect(bar!.open).toBe(0.60);
    expect(bar!.high).toBe(0.65);
    expect(bar!.low).toBe(0.55);
    expect(bar!.close).toBe(0.55);
    expect(bar!.volume).toBeCloseTo(450);
    expect(bar!.trades).toBe(3);
  });

  it('open is always the first trade price in a bar', () => {
    builder.addTrade(0.42, 50, new Date(BASE_1M));
    builder.addTrade(0.99, 50, new Date(BASE_1M + 5_000));

    expect(builder.getCurrentBar('1m')!.open).toBe(0.42);
  });

  it('close is always the last trade price', () => {
    builder.addTrade(0.42, 50, new Date(BASE_1M));
    builder.addTrade(0.99, 50, new Date(BASE_1M + 5_000));
    builder.addTrade(0.77, 50, new Date(BASE_1M + 10_000));

    expect(builder.getCurrentBar('1m')!.close).toBe(0.77);
  });

  it('bar timestamp equals bar open time (floored to interval)', () => {
    // Trade at BASE_1M + 45s is still in the same 1m bar starting at BASE_1M
    builder.addTrade(0.65, 100, new Date(BASE_1M + 45_000));
    const bar = builder.getCurrentBar('1m');

    expect(bar!.timestamp.getTime()).toBe(BASE_1M);
  });
});

// ─── Bar completion ───────────────────────────────────────────────────────────

describe('BarBuilder – bar completion', () => {
  let builder: BarBuilder;

  beforeEach(() => {
    builder = new BarBuilder();
  });

  it('completes a 1m bar when a trade arrives in the next minute', () => {
    builder.addTrade(0.65, 100, new Date(BASE_1M));
    // Trade in next 1m bar
    builder.addTrade(0.70, 200, new Date(BASE_1M + MS_1M));

    const bars = builder.getCompletedBars('1m');
    expect(bars).toHaveLength(1);
    expect(bars[0].open).toBe(0.65);
    expect(bars[0].close).toBe(0.65);
    expect(bars[0].volume).toBe(100);
  });

  it('completes a 5m bar when a trade arrives in the next 5-minute window', () => {
    builder.addTrade(0.65, 100, new Date(BASE_5M));
    builder.addTrade(0.70, 200, new Date(BASE_5M + MS_5M));

    const bars = builder.getCompletedBars('5m');
    expect(bars).toHaveLength(1);
    expect(bars[0].open).toBe(0.65);
    expect(bars[0].volume).toBe(100);
  });

  it('completes a 1h bar when a trade arrives in the next hour', () => {
    builder.addTrade(0.65, 100, new Date(BASE_1H));
    builder.addTrade(0.70, 200, new Date(BASE_1H + MS_1H));

    const bars = builder.getCompletedBars('1h');
    expect(bars).toHaveLength(1);
    expect(bars[0].volume).toBe(100);
  });

  it('archives multiple completed bars in sequence', () => {
    for (let i = 0; i < 5; i++) {
      builder.addTrade(0.60 + i * 0.01, 100 * (i + 1), new Date(BASE_1M + i * MS_1M));
    }

    const bars = builder.getCompletedBars('1m');
    expect(bars).toHaveLength(4); // 4 completed, 1 still in-progress
  });

  it('in-progress bar not included in getCompletedBars after previous bar closes', () => {
    builder.addTrade(0.65, 100, new Date(BASE_1M)); // bar 0
    builder.addTrade(0.70, 200, new Date(BASE_1M + MS_1M)); // bar 1 (bar 0 completes)

    const completed = builder.getCompletedBars('1m');
    const current = builder.getCurrentBar('1m');

    expect(completed).toHaveLength(1);
    expect(current).not.toBeNull();
    expect(current!.open).toBe(0.70);
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe('BarBuilder – deduplication', () => {
  let builder: BarBuilder;

  beforeEach(() => {
    builder = new BarBuilder();
  });

  it('does not duplicate a bar with the same timestamp', () => {
    // Simulate: bar 0 completes, bar 1 starts
    builder.addTrade(0.65, 100, new Date(BASE_1M));
    builder.addTrade(0.70, 100, new Date(BASE_1M + MS_1M));

    // Now simulate bar 1 completing via another call
    builder.addTrade(0.75, 100, new Date(BASE_1M + MS_1M * 2));

    const bars = builder.getCompletedBars('1m');
    const ts0 = bars[0].timestamp.getTime();
    const ts1 = bars[1].timestamp.getTime();

    // No duplicate timestamps
    expect(new Set([ts0, ts1]).size).toBe(2);
    expect(bars).toHaveLength(2);
  });
});

// ─── Rolling window limits ────────────────────────────────────────────────────

describe('BarBuilder – rolling window limits', () => {
  let builder: BarBuilder;

  beforeEach(() => {
    builder = new BarBuilder();
  });

  it('1m bars capped at 15', () => {
    // Create 20 completed 1m bars
    for (let i = 0; i <= 20; i++) {
      builder.addTrade(0.65, 100, new Date(BASE_1M + i * MS_1M));
    }

    expect(builder.getCompletedBars('1m').length).toBeLessThanOrEqual(15);
  });

  it('5m bars capped at 15', () => {
    for (let i = 0; i <= 20; i++) {
      builder.addTrade(0.65, 100, new Date(BASE_5M + i * MS_5M));
    }

    expect(builder.getCompletedBars('5m').length).toBeLessThanOrEqual(15);
  });

  it('1h bars capped at 12', () => {
    for (let i = 0; i <= 15; i++) {
      builder.addTrade(0.65, 100, new Date(BASE_1H + i * MS_1H));
    }

    expect(builder.getCompletedBars('1h').length).toBeLessThanOrEqual(12);
  });

  it('oldest bars are dropped when limit exceeded', () => {
    // Add 17 bars
    for (let i = 0; i <= 17; i++) {
      builder.addTrade(0.60 + i * 0.001, 100, new Date(BASE_1M + i * MS_1M));
    }

    const bars = builder.getCompletedBars('1m');
    expect(bars.length).toBe(15);

    // The oldest bar should be bar index 2 (0 and 1 were dropped)
    // Last completed bar is index 16
    const newest = bars[bars.length - 1];
    const oldest = bars[0];
    expect(newest.timestamp.getTime()).toBeGreaterThan(oldest.timestamp.getTime());
  });

  it('most recent bars are retained after trimming', () => {
    for (let i = 0; i <= 20; i++) {
      builder.addTrade(0.65, i * 10, new Date(BASE_1M + i * MS_1M));
    }

    const bars = builder.getCompletedBars('1m');
    // The most recent completed bar (index 19) should have volume 190
    const newestBar = bars[bars.length - 1];
    expect(newestBar.volume).toBe(190);
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────

describe('BarBuilder – reset', () => {
  it('clears all completed bars and in-progress bar', () => {
    const builder = new BarBuilder();

    builder.addTrade(0.65, 100, new Date(BASE_1M));
    builder.addTrade(0.70, 100, new Date(BASE_1M + MS_1M)); // completes bar

    expect(builder.getCompletedBars('1m')).toHaveLength(1);
    expect(builder.getCurrentBar('1m')).not.toBeNull();

    builder.reset();

    expect(builder.getCompletedBars('1m')).toHaveLength(0);
    expect(builder.getCompletedBars('5m')).toHaveLength(0);
    expect(builder.getCompletedBars('1h')).toHaveLength(0);
    expect(builder.getCurrentBar('1m')).toBeNull();
  });

  it('accepts new trades after reset without dedup issues', () => {
    const builder = new BarBuilder();

    builder.addTrade(0.65, 100, new Date(BASE_1M));
    builder.addTrade(0.70, 100, new Date(BASE_1M + MS_1M)); // completes bar
    builder.reset();

    // Same timestamp, should work fresh after reset
    builder.addTrade(0.55, 50, new Date(BASE_1M));
    builder.addTrade(0.60, 50, new Date(BASE_1M + MS_1M));

    expect(builder.getCompletedBars('1m')).toHaveLength(1);
    expect(builder.getCompletedBars('1m')[0].open).toBe(0.55);
  });
});

// ─── Multi-timeframe consistency ──────────────────────────────────────────────

describe('BarBuilder – multi-timeframe', () => {
  it('maintains independent bars for all three timeframes', () => {
    const builder = new BarBuilder();

    // 3 trades within the first 5m window but across 3 different 1m bars
    builder.addTrade(0.60, 100, new Date(BASE_1M));
    builder.addTrade(0.65, 200, new Date(BASE_1M + MS_1M));
    builder.addTrade(0.70, 300, new Date(BASE_1M + MS_1M * 2));
    // Move to next 5m window to close the 5m bar
    builder.addTrade(0.75, 400, new Date(BASE_5M + MS_5M));

    expect(builder.getCompletedBars('1m')).toHaveLength(3);
    expect(builder.getCompletedBars('5m')).toHaveLength(1);
    // 1h bar not yet closed
    expect(builder.getCompletedBars('1h')).toHaveLength(0);
  });

  it('5m bar aggregates all 1m trades correctly', () => {
    const builder = new BarBuilder();

    // 3 trades in first 5m window
    builder.addTrade(0.60, 100, new Date(BASE_5M));
    builder.addTrade(0.70, 200, new Date(BASE_5M + MS_1M));
    builder.addTrade(0.65, 150, new Date(BASE_5M + MS_1M * 2));
    // Next 5m bar closes the previous
    builder.addTrade(0.50, 50, new Date(BASE_5M + MS_5M));

    const fiveMBar = builder.getCompletedBars('5m')[0];
    expect(fiveMBar.open).toBe(0.60);
    expect(fiveMBar.high).toBe(0.70);
    expect(fiveMBar.low).toBe(0.60);
    expect(fiveMBar.close).toBe(0.65);
    expect(fiveMBar.volume).toBeCloseTo(450);
  });
});
