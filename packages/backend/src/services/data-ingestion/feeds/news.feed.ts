// ─── News API Feed ──────────────────────────────────────────────────────────

import axios from 'axios';
import logger from '../../../config/logger.js';
import { BaseFeed } from '../feed.interface.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const NEWS_API_BASE = 'https://newsapi.org/v2';

interface NewsArticle {
  title: string;
  description: string | null;
  source: { name: string };
  publishedAt: string;
  url: string;
}

const MOCK_HEADLINES = [
  { title: 'Bitcoin surges past key resistance level amid institutional buying', sentiment: 0.7 },
  { title: 'Federal Reserve signals potential rate pause at next meeting', sentiment: 0.3 },
  { title: 'Ethereum upgrade deployment scheduled for next week', sentiment: 0.5 },
  { title: 'Crypto exchange reports record trading volume', sentiment: 0.6 },
  { title: 'SEC delays decision on spot ETF application', sentiment: -0.3 },
  { title: 'Major bank announces blockchain pilot program', sentiment: 0.4 },
  { title: 'Inflation data comes in below expectations', sentiment: 0.5 },
  { title: 'New regulatory framework proposed for digital assets', sentiment: -0.2 },
  { title: 'Tech sector earnings beat analyst expectations', sentiment: 0.4 },
  { title: 'Geopolitical tensions drive safe-haven demand', sentiment: -0.4 },
  { title: 'Presidential approval rating shifts in latest survey', sentiment: 0.0 },
  { title: 'Sports betting market grows 20% year-over-year', sentiment: 0.3 },
];

export class NewsFeed extends BaseFeed {
  readonly name = 'news';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private apiKey: string | null;
  private mockMode = false;

  constructor() {
    super();
    this.apiKey = process.env.NEWS_API_KEY ?? null;
  }

  isEnabled(): boolean {
    return true; // Always enabled — falls back to mock
  }

  async connect(): Promise<void> {
    if (this.apiKey) {
      // Test the API key with a small request
      try {
        await axios.get(`${NEWS_API_BASE}/top-headlines`, {
          params: { country: 'us', pageSize: 1, apiKey: this.apiKey },
          timeout: 10_000,
        });
        this.mockMode = false;
        logger.info('News API feed connected (live mode)');
      } catch {
        logger.warn('News API key invalid or quota exceeded — switching to mock mode');
        this.mockMode = true;
      }
    } else {
      logger.info('No NEWS_API_KEY — running news feed in mock mode');
      this.mockMode = true;
    }

    this.markConnected();

    // Initial fetch
    await this.poll();

    // Start polling
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
        this.emitMockHeadlines();
      } else {
        await this.fetchLiveNews();
      }
    } catch (err) {
      this.markError();
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('News feed poll error', { error: msg });
    }
  }

  private async fetchLiveNews(): Promise<void> {
    const queries = ['crypto bitcoin', 'politics election', 'economy markets'];
    const now = new Date();

    for (const q of queries) {
      try {
        const resp = await axios.get<{ articles: NewsArticle[] }>(
          `${NEWS_API_BASE}/everything`,
          {
            params: {
              q,
              sortBy: 'publishedAt',
              pageSize: 5,
              apiKey: this.apiKey,
              language: 'en',
            },
            timeout: 15_000,
          },
        );

        for (const article of resp.data.articles) {
          this.emit({
            source: 'newsapi',
            data_type: 'headline',
            symbol: q.split(' ')[0],
            timestamp: new Date(article.publishedAt),
            value: {
              title: article.title,
              description: article.description,
              source_name: article.source.name,
              url: article.url,
              sentiment: this.simpleSentiment(article.title),
            },
            metadata: { query: q, fetched_at: now.toISOString(), mock: false },
          });
        }
      } catch {
        this.markError();
      }
    }
  }

  private emitMockHeadlines(): void {
    const now = new Date();
    // Pick 2-3 random headlines
    const count = 2 + Math.floor(Math.random() * 2);
    const shuffled = [...MOCK_HEADLINES].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
      const headline = shuffled[i];
      const category = headline.sentiment > 0.2 ? 'crypto' : 'politics';

      this.emit({
        source: 'newsapi',
        data_type: 'headline',
        symbol: category,
        timestamp: now,
        value: {
          title: headline.title,
          description: null,
          source_name: 'MockNews',
          url: 'https://example.com/mock',
          sentiment: headline.sentiment,
        },
        metadata: { mock: true },
      });
    }
  }

  /**
   * Very basic keyword-based sentiment. Real implementation would use NLP or AI.
   */
  private simpleSentiment(title: string): number {
    const lower = title.toLowerCase();
    let score = 0;

    const positive = ['surge', 'rally', 'beat', 'growth', 'gain', 'record', 'approval', 'upgrade', 'bullish'];
    const negative = ['crash', 'fall', 'drop', 'fear', 'delay', 'risk', 'tension', 'decline', 'bearish', 'hack'];

    for (const w of positive) {
      if (lower.includes(w)) score += 0.3;
    }
    for (const w of negative) {
      if (lower.includes(w)) score -= 0.3;
    }

    return Math.max(-1, Math.min(1, score));
  }
}
