import { describe, it, expect, beforeEach } from 'vitest';
import { SessionVolumeNormalizer } from '../../../src/services/data-ingestion/session-volume.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a Date at a specific UTC hour:minute */
function utcTime(hour: number, minute = 0): Date {
  const d = new Date('2025-01-01T00:00:00.000Z');
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

// ─── getSession – bucket assignment ───────────────────────────────────────────

describe('SessionVolumeNormalizer.getSession', () => {
  let normalizer: SessionVolumeNormalizer;

  beforeEach(() => {
    normalizer = new SessionVolumeNormalizer();
  });

  // asia_open: 00:00 – 03:00
  it('00:00 → asia_open', () => {
    expect(normalizer.getSession(utcTime(0, 0))).toBe('asia_open');
  });

  it('01:30 → asia_open', () => {
    expect(normalizer.getSession(utcTime(1, 30))).toBe('asia_open');
  });

  it('02:59 → asia_open', () => {
    expect(normalizer.getSession(utcTime(2, 59))).toBe('asia_open');
  });

  // overnight: 03:00 – 09:00
  it('03:00 → overnight (exact boundary)', () => {
    expect(normalizer.getSession(utcTime(3, 0))).toBe('overnight');
  });

  it('06:00 → overnight', () => {
    expect(normalizer.getSession(utcTime(6, 0))).toBe('overnight');
  });

  it('08:59 → overnight', () => {
    expect(normalizer.getSession(utcTime(8, 59))).toBe('overnight');
  });

  // europe_open: 09:00 – 13:30
  it('09:00 → europe_open (exact boundary)', () => {
    expect(normalizer.getSession(utcTime(9, 0))).toBe('europe_open');
  });

  it('11:00 → europe_open', () => {
    expect(normalizer.getSession(utcTime(11, 0))).toBe('europe_open');
  });

  it('13:29 → europe_open', () => {
    expect(normalizer.getSession(utcTime(13, 29))).toBe('europe_open');
  });

  // us_open: 13:30 – 15:30
  it('13:30 → us_open (exact boundary)', () => {
    expect(normalizer.getSession(utcTime(13, 30))).toBe('us_open');
  });

  it('14:00 → us_open', () => {
    expect(normalizer.getSession(utcTime(14, 0))).toBe('us_open');
  });

  it('15:29 → us_open', () => {
    expect(normalizer.getSession(utcTime(15, 29))).toBe('us_open');
  });

  // us_midday: 15:30 – 18:00
  it('15:30 → us_midday (exact boundary)', () => {
    expect(normalizer.getSession(utcTime(15, 30))).toBe('us_midday');
  });

  it('16:00 → us_midday', () => {
    expect(normalizer.getSession(utcTime(16, 0))).toBe('us_midday');
  });

  it('17:59 → us_midday', () => {
    expect(normalizer.getSession(utcTime(17, 59))).toBe('us_midday');
  });

  // us_close: 18:00 – 24:00
  it('18:00 → us_close (exact boundary)', () => {
    expect(normalizer.getSession(utcTime(18, 0))).toBe('us_close');
  });

  it('20:00 → us_close', () => {
    expect(normalizer.getSession(utcTime(20, 0))).toBe('us_close');
  });

  it('23:59 → us_close', () => {
    expect(normalizer.getSession(utcTime(23, 59))).toBe('us_close');
  });
});

// ─── addVolume – routes to correct bucket ─────────────────────────────────────

describe('SessionVolumeNormalizer.addVolume', () => {
  it('adds volume to the correct session bucket', () => {
    const normalizer = new SessionVolumeNormalizer();

    // Add 4+ observations to enable normalization
    for (let i = 0; i < 5; i++) {
      normalizer.addVolume(1000, utcTime(14, 0)); // us_open
    }

    const stats = normalizer.getStats();
    expect(stats.us_open.count).toBe(5);
    expect(stats.asia_open.count).toBe(0);
    expect(stats.overnight.count).toBe(0);
  });

  it('separates volumes by session', () => {
    const normalizer = new SessionVolumeNormalizer();

    for (let i = 0; i < 4; i++) {
      normalizer.addVolume(500, utcTime(1, 0));  // asia_open
      normalizer.addVolume(800, utcTime(14, 0)); // us_open
    }

    const stats = normalizer.getStats();
    expect(stats.asia_open.count).toBe(4);
    expect(stats.us_open.count).toBe(4);
    expect(stats.asia_open.average).toBeCloseTo(500);
    expect(stats.us_open.average).toBeCloseTo(800);
  });

  it('trims history to maxHistory when exceeded', () => {
    const normalizer = new SessionVolumeNormalizer(5); // max 5 per bucket

    for (let i = 0; i < 10; i++) {
      normalizer.addVolume(100, utcTime(14, 0));
    }

    expect(normalizer.getStats().us_open.count).toBe(5);
  });
});

// ─── normalizeVolume – ratio calculation ──────────────────────────────────────

describe('SessionVolumeNormalizer.normalizeVolume', () => {
  it('returns null when fewer than 4 observations in bucket', () => {
    const normalizer = new SessionVolumeNormalizer();
    normalizer.addVolume(1000, utcTime(14, 0));
    normalizer.addVolume(1000, utcTime(14, 0));
    normalizer.addVolume(1000, utcTime(14, 0)); // only 3

    expect(normalizer.normalizeVolume(2000, utcTime(14, 0))).toBeNull();
  });

  it('returns ratio once 4 observations exist', () => {
    const normalizer = new SessionVolumeNormalizer();

    for (let i = 0; i < 4; i++) {
      normalizer.addVolume(1000, utcTime(14, 0));
    }

    // Average is 1000, so ratio of 2000 should be 2.0
    const ratio = normalizer.normalizeVolume(2000, utcTime(14, 0));
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(2.0);
  });

  it('ratio of 1.0 for volume equal to average', () => {
    const normalizer = new SessionVolumeNormalizer();

    for (let i = 0; i < 8; i++) {
      normalizer.addVolume(500, utcTime(14, 0));
    }

    const ratio = normalizer.normalizeVolume(500, utcTime(14, 0));
    expect(ratio!).toBeCloseTo(1.0);
  });

  it('ratio below 1 for volume below average', () => {
    const normalizer = new SessionVolumeNormalizer();

    for (let i = 0; i < 8; i++) {
      normalizer.addVolume(1000, utcTime(14, 0));
    }

    const ratio = normalizer.normalizeVolume(250, utcTime(14, 0));
    expect(ratio!).toBeCloseTo(0.25);
  });

  it('normalizes against the correct session (different buckets are independent)', () => {
    const normalizer = new SessionVolumeNormalizer();

    // us_open average = 500
    for (let i = 0; i < 8; i++) {
      normalizer.addVolume(500, utcTime(14, 0)); // us_open
    }

    // asia_open bucket empty → returns null for asia_open timestamp
    expect(normalizer.normalizeVolume(500, utcTime(1, 0))).toBeNull();
  });
});

// ─── IQR outlier removal ─────────────────────────────────────────────────────

describe('SessionVolumeNormalizer – IQR outlier removal', () => {
  it('excludes extreme outliers from average calculation', () => {
    const normalizer = new SessionVolumeNormalizer();

    // 8 "normal" values of 1000, plus one extreme outlier
    for (let i = 0; i < 8; i++) {
      normalizer.addVolume(1000, utcTime(14, 0));
    }
    normalizer.addVolume(1_000_000, utcTime(14, 0)); // extreme outlier

    // Average without outlier ≈ 1000; with outlier it would be ~111k
    // Ratio should be close to 1.0 (not 1/111)
    const ratio = normalizer.normalizeVolume(1000, utcTime(14, 0));
    expect(ratio!).toBeGreaterThan(0.5);
    expect(ratio!).toBeLessThan(2.0);
  });

  it('maintains precision with tightly clustered values', () => {
    const normalizer = new SessionVolumeNormalizer();

    const base = 1000;
    for (let i = 0; i < 10; i++) {
      normalizer.addVolume(base + i, utcTime(14, 0)); // 1000-1009
    }

    // Average ≈ 1004.5, ratio of 1004.5 ≈ 1.0
    const ratio = normalizer.normalizeVolume(1004.5, utcTime(14, 0));
    expect(ratio!).toBeCloseTo(1.0, 1);
  });

  it('returns non-null when enough values remain after IQR cleaning', () => {
    const normalizer = new SessionVolumeNormalizer();

    // 6 normal values + 2 outliers
    for (let i = 0; i < 6; i++) {
      normalizer.addVolume(100, utcTime(14, 0));
    }
    normalizer.addVolume(0.001, utcTime(14, 0)); // low outlier
    normalizer.addVolume(100_000, utcTime(14, 0)); // high outlier

    const ratio = normalizer.normalizeVolume(100, utcTime(14, 0));
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(1.0, 0);
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('SessionVolumeNormalizer.getStats', () => {
  it('returns count=0 and average=null for empty buckets', () => {
    const normalizer = new SessionVolumeNormalizer();
    const stats = normalizer.getStats();

    for (const name of ['us_open', 'us_midday', 'us_close', 'asia_open', 'overnight', 'europe_open'] as const) {
      expect(stats[name].count).toBe(0);
      expect(stats[name].average).toBeNull();
    }
  });

  it('returns correct average for a populated bucket', () => {
    const normalizer = new SessionVolumeNormalizer();

    normalizer.addVolume(100, utcTime(14, 0));
    normalizer.addVolume(200, utcTime(14, 0));
    normalizer.addVolume(300, utcTime(14, 0));
    normalizer.addVolume(400, utcTime(14, 0));

    const stats = normalizer.getStats();
    expect(stats.us_open.count).toBe(4);
    expect(stats.us_open.average).toBeCloseTo(250);
  });

  it('covers all 6 session names in stats output', () => {
    const normalizer = new SessionVolumeNormalizer();
    const stats = normalizer.getStats();
    const keys = Object.keys(stats);

    expect(keys).toContain('us_open');
    expect(keys).toContain('us_midday');
    expect(keys).toContain('us_close');
    expect(keys).toContain('asia_open');
    expect(keys).toContain('overnight');
    expect(keys).toContain('europe_open');
    expect(keys).toHaveLength(6);
  });
});
