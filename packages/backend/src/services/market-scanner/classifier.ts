/**
 * Keyword-based market category classifier.
 *
 * Classifies a market by its title, description, and tags into one of the
 * MarketCategory enum values: crypto | politics | sports | events | entertainment | other.
 *
 * Categories are checked in priority order; the first that matches wins.
 * Returns 'other' if no keywords match.
 */
import type { MarketCategory } from '@prisma/client';

interface CategoryRule {
  category: MarketCategory;
  keywords: string[];
}

const RULES: CategoryRule[] = [
  {
    category: 'crypto',
    keywords: [
      'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
      'blockchain', 'defi', 'nft', 'altcoin', 'stablecoin', 'usdc', 'usdt',
      'binance', 'coinbase', 'exchange', 'token', 'web3', 'dao', 'l2',
      'layer 2', 'layer2', 'polygon', 'avalanche', 'cardano', 'ripple', 'xrp',
      'dogecoin', 'shiba', 'doge', 'halving', 'memecoin', 'airdrop',
    ],
  },
  {
    category: 'politics',
    keywords: [
      'president', 'election', 'senate', 'congress', 'parliament', 'government',
      'democrat', 'republican', 'federal reserve', 'fed rate', 'interest rate',
      'inflation', 'gdp', 'recession', 'policy', 'legislation', 'bill',
      'supreme court', 'nato', 'treaty', 'sanction', 'tariff', 'trade war',
      'geopolit', 'military', 'war', 'ceasefire', 'diplomat', 'minister',
      'prime minister', 'chancellor', 'referendum', 'ballot', 'vote', 'veto',
      'central bank', 'fiscal', 'debt ceiling', 'shutdown', 'impeach',
    ],
  },
  {
    category: 'sports',
    keywords: [
      'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football', 'basketball',
      'baseball', 'hockey', 'tennis', 'golf', 'mma', 'ufc', 'boxing',
      'olympics', 'world cup', 'champion', 'championship', 'league', 'cup',
      'playoff', 'superbowl', 'super bowl', 'wimbledon', 'grand slam',
      'formula 1', 'f1', 'racing', 'athlete', 'team', 'game', 'match',
      'tournament', 'season', 'draft', 'trade', 'coach', 'manager',
    ],
  },
  {
    category: 'entertainment',
    keywords: [
      'movie', 'film', 'oscar', 'grammy', 'emmy', 'golden globe', 'award',
      'box office', 'streaming', 'netflix', 'disney', 'hbo', 'amazon prime',
      'spotify', 'album', 'song', 'music', 'band', 'artist', 'celebrity',
      'actor', 'actress', 'director', 'television', 'tv show', 'series',
      'youtube', 'tiktok', 'influencer', 'pop culture', 'trailer', 'release',
      'box office', 'ticket sales', 'concert', 'tour',
    ],
  },
  {
    category: 'events',
    keywords: [
      'earthquake', 'hurricane', 'flood', 'wildfire', 'natural disaster',
      'volcano', 'tsunami', 'pandemic', 'disease', 'outbreak', 'virus',
      'fda', 'drug approval', 'clinical trial', 'space', 'nasa', 'spacex',
      'launch', 'landing', 'asteroid', 'ai', 'artificial intelligence',
      'openai', 'gpt', 'chatgpt', 'gemini', 'anthropic', 'ipo', 'merger',
      'acquisition', 'bankruptcy', 'tech', 'startup', 'unicorn', 'ipo',
    ],
  },
];

/** Normalise text for keyword matching. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
}

/** Test whether a keyword appears at a word boundary in the haystack. */
function matchesKeyword(haystack: string, kw: string): boolean {
  // Require a leading word boundary so short tickers like 'sol', 'eth' don't
  // false-match inside words like 'resolves' or 'whether'.
  // No trailing boundary is required so 'oscar' still matches 'oscars',
  // 'eth' still matches 'ethereum', 'sol' still matches 'solana', etc.
  return new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}`).test(haystack);
}

/**
 * Classify a market into a MarketCategory.
 *
 * @param title       Market question/title
 * @param description Optional description text
 * @param tags        Tags as strings or label-bearing objects
 */
export function classifyMarket(
  title: string,
  description?: string,
  tags?: Array<string | { label?: string; slug?: string }>,
): MarketCategory {
  const tagText = (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : `${t.label ?? ''} ${t.slug ?? ''}`))
    .join(' ');

  const haystack = normalise(`${title} ${description ?? ''} ${tagText}`);

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => matchesKeyword(haystack, kw))) {
      return rule.category;
    }
  }

  return 'other';
}
