// ─── OHLCV Bar Builder ──────────────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '1h';

export interface OHLCVBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date; // bar open time
  trades: number;
}

interface InProgressBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
  trades: number;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
};

const MAX_BARS: Record<Timeframe, number> = {
  '1m': 15,
  '5m': 15,
  '1h': 12,
};

/**
 * Builds rolling OHLCV bars from trade data.
 * Maintains separate windows for 1m, 5m, and 1h timeframes.
 * Drops the in-progress bar — only completed bars are returned.
 */
export class BarBuilder {
  private completed: Record<Timeframe, OHLCVBar[]> = {
    '1m': [],
    '5m': [],
    '1h': [],
  };

  private current: Record<Timeframe, InProgressBar | null> = {
    '1m': null,
    '5m': null,
    '1h': null,
  };

  // Track seen bar timestamps to dedup
  private seenTimestamps: Record<Timeframe, Set<number>> = {
    '1m': new Set(),
    '5m': new Set(),
    '1h': new Set(),
  };

  /**
   * Process a new trade tick and update all timeframe bars.
   */
  addTrade(price: number, volume: number, timestamp: Date): void {
    const ts = timestamp.getTime();

    for (const tf of ['1m', '5m', '1h'] as Timeframe[]) {
      const intervalMs = TIMEFRAME_MS[tf];
      const barOpenMs = Math.floor(ts / intervalMs) * intervalMs;
      const barOpen = new Date(barOpenMs);

      const cur = this.current[tf];

      if (cur && cur.timestamp.getTime() !== barOpenMs) {
        // Current bar is complete — archive it
        this.archiveBar(tf, cur);
        this.current[tf] = null;
      }

      if (!this.current[tf]) {
        this.current[tf] = {
          open: price,
          high: price,
          low: price,
          close: price,
          volume,
          timestamp: barOpen,
          trades: 1,
        };
      } else {
        const bar = this.current[tf]!;
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = price;
        bar.volume += volume;
        bar.trades++;
      }
    }
  }

  /**
   * Returns only completed bars for the given timeframe.
   * The in-progress bar is intentionally excluded (partial volume is misleading).
   */
  getCompletedBars(timeframe: Timeframe): readonly OHLCVBar[] {
    return this.completed[timeframe];
  }

  /**
   * Get the current (in-progress) bar for a timeframe.
   * Use with caution — volume is incomplete.
   */
  getCurrentBar(timeframe: Timeframe): OHLCVBar | null {
    const bar = this.current[timeframe];
    if (!bar) return null;
    return { ...bar };
  }

  /**
   * Reset all bars and state.
   */
  reset(): void {
    for (const tf of ['1m', '5m', '1h'] as Timeframe[]) {
      this.completed[tf] = [];
      this.current[tf] = null;
      this.seenTimestamps[tf].clear();
    }
  }

  private archiveBar(timeframe: Timeframe, bar: InProgressBar): void {
    const barTs = bar.timestamp.getTime();

    // Dedup: don't archive a bar we've already seen
    if (this.seenTimestamps[timeframe].has(barTs)) return;
    this.seenTimestamps[timeframe].add(barTs);

    const completedBar: OHLCVBar = { ...bar };
    this.completed[timeframe].push(completedBar);

    // Trim to max bars
    const max = MAX_BARS[timeframe];
    if (this.completed[timeframe].length > max) {
      const removed = this.completed[timeframe].splice(
        0,
        this.completed[timeframe].length - max,
      );
      // Clean up seen timestamps for removed bars
      for (const r of removed) {
        this.seenTimestamps[timeframe].delete(r.timestamp.getTime());
      }
    }
  }
}
