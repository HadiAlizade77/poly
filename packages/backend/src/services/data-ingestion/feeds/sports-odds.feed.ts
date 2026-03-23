// ─── Sports Odds Feed ───────────────────────────────────────────────────────

import axios from 'axios';
import logger from '../../../config/logger.js';
import { BaseFeed } from '../feed.interface.js';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface OddsApiOutcome {
  name: string;
  price: number;
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: Array<{
    key: string;
    outcomes: OddsApiOutcome[];
  }>;
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

interface MockGame {
  sport: string;
  home: string;
  away: string;
  homeOdds: number;
  awayOdds: number;
  drawOdds?: number;
}

const MOCK_GAMES: MockGame[] = [
  { sport: 'basketball_nba', home: 'Lakers', away: 'Celtics', homeOdds: -130, awayOdds: +110 },
  { sport: 'basketball_nba', home: 'Warriors', away: 'Bucks', homeOdds: +105, awayOdds: -125 },
  { sport: 'americanfootball_nfl', home: 'Chiefs', away: 'Eagles', homeOdds: -150, awayOdds: +130 },
  { sport: 'baseball_mlb', home: 'Yankees', away: 'Dodgers', homeOdds: +100, awayOdds: -120 },
  { sport: 'soccer_epl', home: 'Arsenal', away: 'Man City', homeOdds: +180, awayOdds: +140, drawOdds: +230 },
  { sport: 'icehockey_nhl', home: 'Oilers', away: 'Panthers', homeOdds: -110, awayOdds: -110 },
];

export class SportsOddsFeed extends BaseFeed {
  readonly name = 'sports-odds';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private apiKey: string | null;
  private mockMode = false;

  constructor() {
    super();
    this.apiKey = process.env.ODDS_API_KEY ?? null;
  }

  isEnabled(): boolean {
    return true; // Falls back to mock
  }

  async connect(): Promise<void> {
    if (this.apiKey) {
      try {
        await axios.get(`${ODDS_API_BASE}/sports`, {
          params: { apiKey: this.apiKey },
          timeout: 10_000,
        });
        this.mockMode = false;
        logger.info('Sports Odds feed connected (live mode)');
      } catch {
        logger.warn('Odds API key invalid or unavailable — switching to mock mode');
        this.mockMode = true;
      }
    } else {
      logger.info('No ODDS_API_KEY — running sports odds feed in mock mode');
      this.mockMode = true;
    }

    this.markConnected();
    await this.poll();

    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.markDisconnected();
  }

  private async poll(): Promise<void> {
    try {
      if (this.mockMode) {
        this.emitMockOdds();
      } else {
        await this.fetchLiveOdds();
      }
    } catch (err) {
      this.markError();
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Sports odds poll error', { error: msg });
    }
  }

  private async fetchLiveOdds(): Promise<void> {
    const sports = ['basketball_nba', 'americanfootball_nfl', 'baseball_mlb'];
    const now = new Date();

    for (const sport of sports) {
      try {
        const resp = await axios.get<OddsApiEvent[]>(
          `${ODDS_API_BASE}/sports/${sport}/odds`,
          {
            params: {
              apiKey: this.apiKey,
              regions: 'us',
              markets: 'h2h',
              oddsFormat: 'american',
            },
            timeout: 15_000,
          },
        );

        for (const event of resp.data) {
          const consensus = this.buildConsensus(event.bookmakers);

          this.emit({
            source: 'odds-api',
            data_type: 'game_odds',
            symbol: `${event.home_team}_vs_${event.away_team}`.toLowerCase().replace(/\s+/g, '_'),
            timestamp: now,
            value: {
              sport: event.sport_key,
              sport_title: event.sport_title,
              home_team: event.home_team,
              away_team: event.away_team,
              commence_time: event.commence_time,
              consensus,
              bookmaker_count: event.bookmakers.length,
            },
            metadata: { event_id: event.id, mock: false },
          });
        }
      } catch {
        this.markError();
      }
    }
  }

  private emitMockOdds(): void {
    const now = new Date();

    for (const game of MOCK_GAMES) {
      // Add small random line movement
      const homeShift = Math.round((Math.random() - 0.5) * 20);
      const awayShift = -homeShift;

      const homeOdds = game.homeOdds + homeShift;
      const awayOdds = game.awayOdds + awayShift;

      const symbol = `${game.home}_vs_${game.away}`.toLowerCase().replace(/\s+/g, '_');

      // Convert American odds to implied probability
      const homeProb = this.americanToProb(homeOdds);
      const awayProb = this.americanToProb(awayOdds);
      const drawProb = game.drawOdds ? this.americanToProb(game.drawOdds + Math.round((Math.random() - 0.5) * 15)) : undefined;

      this.emit({
        source: 'odds-api',
        data_type: 'game_odds',
        symbol,
        timestamp: now,
        value: {
          sport: game.sport,
          sport_title: game.sport.replace(/_/g, ' '),
          home_team: game.home,
          away_team: game.away,
          commence_time: new Date(now.getTime() + 86_400_000).toISOString(), // tomorrow
          consensus: {
            home: { american: homeOdds, implied_prob: homeProb },
            away: { american: awayOdds, implied_prob: awayProb },
            ...(drawProb !== undefined
              ? { draw: { american: game.drawOdds!, implied_prob: drawProb } }
              : {}),
          },
          bookmaker_count: 3,
        },
        metadata: { mock: true },
      });
    }
  }

  private buildConsensus(
    bookmakers: OddsApiBookmaker[],
  ): Record<string, { american: number; implied_prob: number }> {
    const totals: Record<string, number[]> = {};

    for (const bm of bookmakers) {
      for (const market of bm.markets) {
        if (market.key !== 'h2h') continue;
        for (const outcome of market.outcomes) {
          if (!totals[outcome.name]) totals[outcome.name] = [];
          totals[outcome.name].push(outcome.price);
        }
      }
    }

    const consensus: Record<string, { american: number; implied_prob: number }> = {};
    for (const [name, prices] of Object.entries(totals)) {
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      consensus[name] = {
        american: avg,
        implied_prob: this.americanToProb(avg),
      };
    }

    return consensus;
  }

  private americanToProb(odds: number): number {
    if (odds > 0) {
      return Math.round((100 / (odds + 100)) * 10000) / 10000;
    }
    return Math.round((Math.abs(odds) / (Math.abs(odds) + 100)) * 10000) / 10000;
  }
}
