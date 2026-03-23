// ─── Session-Aware Volume Normalization ─────────────────────────────────────

/**
 * UTC time-of-day sessions for crypto markets.
 * Volume patterns differ significantly by session.
 */
export type SessionName =
  | 'us_open'
  | 'us_midday'
  | 'us_close'
  | 'asia_open'
  | 'overnight'
  | 'europe_open';

interface SessionWindow {
  name: SessionName;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const SESSIONS: SessionWindow[] = [
  { name: 'asia_open', startHour: 0, startMinute: 0, endHour: 3, endMinute: 0 },
  { name: 'overnight', startHour: 3, startMinute: 0, endHour: 9, endMinute: 0 },
  { name: 'europe_open', startHour: 9, startMinute: 0, endHour: 13, endMinute: 30 },
  { name: 'us_open', startHour: 13, startMinute: 30, endHour: 15, endMinute: 30 },
  { name: 'us_midday', startHour: 15, startMinute: 30, endHour: 18, endMinute: 0 },
  { name: 'us_close', startHour: 18, startMinute: 0, endHour: 24, endMinute: 0 },
];

interface BucketStats {
  values: number[];
}

/**
 * Normalizes volume relative to the session average, with IQR-based outlier removal.
 *
 * Maintains a rolling history of volume observations per session bucket.
 * normalizeVolume() returns the ratio of the given volume vs the cleaned session average.
 */
export class SessionVolumeNormalizer {
  private buckets: Record<SessionName, BucketStats> = {
    us_open: { values: [] },
    us_midday: { values: [] },
    us_close: { values: [] },
    asia_open: { values: [] },
    overnight: { values: [] },
    europe_open: { values: [] },
  };

  private readonly maxHistory: number;

  constructor(maxHistory = 500) {
    this.maxHistory = maxHistory;
  }

  /**
   * Determine which session a UTC timestamp falls into.
   */
  getSession(timestamp: Date): SessionName {
    const hours = timestamp.getUTCHours();
    const minutes = timestamp.getUTCMinutes();
    const timeInMinutes = hours * 60 + minutes;

    for (const session of SESSIONS) {
      const start = session.startHour * 60 + session.startMinute;
      const end = session.endHour * 60 + session.endMinute;
      if (timeInMinutes >= start && timeInMinutes < end) {
        return session.name;
      }
    }

    // Fallback (should not happen with contiguous sessions)
    return 'overnight';
  }

  /**
   * Record a volume observation for the appropriate session.
   */
  addVolume(volume: number, timestamp: Date): void {
    const session = this.getSession(timestamp);
    const bucket = this.buckets[session];
    bucket.values.push(volume);

    // Trim to max history
    if (bucket.values.length > this.maxHistory) {
      bucket.values.splice(0, bucket.values.length - this.maxHistory);
    }
  }

  /**
   * Normalize a volume value relative to the session average.
   *
   * Returns ratio: volume / session_average_after_iqr_cleaning.
   * Returns null if insufficient data (need at least 4 observations).
   */
  normalizeVolume(volume: number, timestamp: Date): number | null {
    const session = this.getSession(timestamp);
    const bucket = this.buckets[session];

    if (bucket.values.length < 4) return null;

    const cleaned = this.removeOutliers(bucket.values);
    if (cleaned.length === 0) return null;

    const avg = cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
    if (avg === 0) return null;

    return volume / avg;
  }

  /**
   * Get session statistics for debugging/monitoring.
   */
  getStats(): Record<SessionName, { count: number; average: number | null }> {
    const result = {} as Record<SessionName, { count: number; average: number | null }>;

    for (const [name, bucket] of Object.entries(this.buckets)) {
      const cleaned = this.removeOutliers(bucket.values);
      const avg =
        cleaned.length > 0
          ? cleaned.reduce((a, b) => a + b, 0) / cleaned.length
          : null;
      result[name as SessionName] = {
        count: bucket.values.length,
        average: avg,
      };
    }

    return result;
  }

  /**
   * Remove outliers using IQR method.
   * Values outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] are excluded.
   */
  private removeOutliers(values: number[]): number[] {
    if (values.length < 4) return [...values];

    const sorted = [...values].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;

    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;

    return values.filter((v) => v >= lower && v <= upper);
  }
}
