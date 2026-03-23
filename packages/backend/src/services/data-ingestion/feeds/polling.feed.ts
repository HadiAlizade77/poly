// ─── Political Polling Data Feed ────────────────────────────────────────────

import logger from '../../../config/logger.js';
import { BaseFeed } from '../feed.interface.js';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Mock political polling data feed.
 *
 * In production, this would connect to polling aggregators (FiveThirtyEight, RCP, etc.).
 * For now, it generates realistic mock polling data.
 */

interface MockCandidate {
  name: string;
  party: string;
  baseSupport: number; // 0-100
}

interface MockRace {
  race: string;
  type: 'presidential' | 'senate' | 'governor';
  state: string;
  candidates: MockCandidate[];
}

const MOCK_RACES: MockRace[] = [
  {
    race: 'President 2026',
    type: 'presidential',
    state: 'national',
    candidates: [
      { name: 'Candidate A', party: 'D', baseSupport: 47 },
      { name: 'Candidate B', party: 'R', baseSupport: 46 },
    ],
  },
  {
    race: 'PA Senate',
    type: 'senate',
    state: 'PA',
    candidates: [
      { name: 'Senator X', party: 'D', baseSupport: 48 },
      { name: 'Challenger Y', party: 'R', baseSupport: 44 },
    ],
  },
  {
    race: 'GA Governor',
    type: 'governor',
    state: 'GA',
    candidates: [
      { name: 'Governor M', party: 'R', baseSupport: 50 },
      { name: 'Candidate N', party: 'D', baseSupport: 43 },
    ],
  },
];

export class PollingFeed extends BaseFeed {
  readonly name = 'polling';

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  isEnabled(): boolean {
    return true; // Always runs in mock mode
  }

  async connect(): Promise<void> {
    logger.info('Polling feed running in mock mode');
    this.markConnected();

    // Emit initial data
    this.emitPollingData();

    // Schedule periodic updates
    this.pollTimer = setInterval(() => {
      this.emitPollingData();
    }, POLL_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.markDisconnected();
  }

  private emitPollingData(): void {
    const now = new Date();

    for (const race of MOCK_RACES) {
      // Add noise to base support
      const results = race.candidates.map((c) => {
        const noise = (Math.random() - 0.5) * 4; // ±2 points
        const support = Math.max(0, Math.min(100, c.baseSupport + noise));
        return {
          name: c.name,
          party: c.party,
          support: Math.round(support * 10) / 10,
        };
      });

      const undecided =
        100 - results.reduce((sum, r) => sum + r.support, 0);

      // Simulated polling metadata
      const sampleSize = 800 + Math.floor(Math.random() * 700); // 800-1500
      const marginOfError = Math.round((100 / Math.sqrt(sampleSize)) * 10) / 10;

      const pollster =
        ['Quinnipiac', 'Marist', 'Emerson', 'SurveyUSA', 'YouGov'][
          Math.floor(Math.random() * 5)
        ];

      this.emit({
        source: 'polling',
        data_type: 'poll_result',
        symbol: race.race.toLowerCase().replace(/\s+/g, '_'),
        timestamp: now,
        value: {
          race: race.race,
          race_type: race.type,
          state: race.state,
          results,
          undecided: Math.max(0, Math.round(undecided * 10) / 10),
          sample_size: sampleSize,
          margin_of_error: marginOfError,
          pollster,
        },
        metadata: { mock: true },
      });
    }
  }
}
