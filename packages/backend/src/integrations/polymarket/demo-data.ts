/**
 * Synthetic Polymarket-shaped markets for demo / dev mode.
 * Covers all MarketCategory values with realistic titles, tokens, and prices.
 */
import type { PolymarketMarket } from './types.js';

function yesNo(yesPrice: number, conditionId: string): PolymarketMarket['tokens'] {
  const yp = Math.max(0.01, Math.min(0.99, yesPrice));
  return [
    { token_id: `${conditionId}-yes`, outcome: 'Yes', price: yp },
    { token_id: `${conditionId}-no`,  outcome: 'No',  price: parseFloat((1 - yp).toFixed(4)) },
  ];
}

function future(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

export const DEMO_MARKETS: PolymarketMarket[] = [
  // ── Crypto ──────────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-crypto-001',
    question: 'Will Bitcoin close above $100,000 before end of 2025?',
    description: 'Resolves YES if BTC/USD closes above $100,000 on Coinbase on or before Dec 31, 2025.',
    market_slug: 'btc-above-100k-2025',
    end_date_iso: future(180),
    tokens: yesNo(0.62, 'demo-crypto-001'),
    tags: [{ id: 1, label: 'Bitcoin', slug: 'bitcoin' }, { id: 2, label: 'Crypto', slug: 'crypto' }],
    active: true, closed: false, archived: false,
    volume: '2500000.00', volume_24hr: '45000.00', liquidity: '320000.00',
  },
  {
    condition_id: 'demo-crypto-002',
    question: 'Will Ethereum price exceed $5,000 in Q2 2025?',
    description: 'Resolves YES if ETH/USD reaches $5,000 on any major exchange in Q2 2025.',
    market_slug: 'eth-above-5000-q2-2025',
    end_date_iso: future(90),
    tokens: yesNo(0.38, 'demo-crypto-002'),
    tags: [{ id: 3, label: 'Ethereum', slug: 'ethereum' }, { id: 2, label: 'Crypto', slug: 'crypto' }],
    active: true, closed: false, archived: false,
    volume: '1800000.00', volume_24hr: '32000.00', liquidity: '210000.00',
  },
  {
    condition_id: 'demo-crypto-003',
    question: 'Will a spot Bitcoin ETF see over $10B in net inflows in 2025?',
    description: 'Resolves YES if combined net inflows across all US spot BTC ETFs exceed $10B.',
    market_slug: 'btc-etf-10b-inflows-2025',
    end_date_iso: future(300),
    tokens: yesNo(0.71, 'demo-crypto-003'),
    tags: [{ id: 1, label: 'Bitcoin', slug: 'bitcoin' }, { id: 4, label: 'ETF', slug: 'etf' }],
    active: true, closed: false, archived: false,
    volume: '980000.00', volume_24hr: '18500.00', liquidity: '145000.00',
  },
  {
    condition_id: 'demo-crypto-004',
    question: 'Will Solana flip Ethereum by market cap in 2025?',
    description: 'Resolves YES if SOL market cap exceeds ETH market cap at any point in 2025.',
    market_slug: 'sol-flip-eth-2025',
    end_date_iso: future(280),
    tokens: yesNo(0.22, 'demo-crypto-004'),
    tags: [{ id: 5, label: 'Solana', slug: 'solana' }, { id: 3, label: 'Ethereum', slug: 'ethereum' }],
    active: true, closed: false, archived: false,
    volume: '650000.00', volume_24hr: '12000.00', liquidity: '88000.00',
  },

  // ── Politics ─────────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-politics-001',
    question: 'Will the US Federal Reserve cut rates in March 2025?',
    description: 'Resolves YES if the FOMC announces a federal funds rate cut at its March 2025 meeting.',
    market_slug: 'fed-cut-march-2025',
    end_date_iso: future(20),
    tokens: yesNo(0.18, 'demo-politics-001'),
    tags: [{ id: 10, label: 'Federal Reserve', slug: 'fed' }, { id: 11, label: 'Economy', slug: 'economy' }],
    active: true, closed: false, archived: false,
    volume: '3200000.00', volume_24hr: '68000.00', liquidity: '510000.00',
  },
  {
    condition_id: 'demo-politics-002',
    question: 'Will there be a US government shutdown in 2025?',
    description: 'Resolves YES if the US government enters a federal shutdown (lapse in appropriations) during 2025.',
    market_slug: 'us-govt-shutdown-2025',
    end_date_iso: future(250),
    tokens: yesNo(0.45, 'demo-politics-002'),
    tags: [{ id: 12, label: 'US Politics', slug: 'us-politics' }, { id: 13, label: 'Congress', slug: 'congress' }],
    active: true, closed: false, archived: false,
    volume: '2100000.00', volume_24hr: '44000.00', liquidity: '380000.00',
  },
  {
    condition_id: 'demo-politics-003',
    question: 'Will NATO expand to include a new member in 2025?',
    description: 'Resolves YES if NATO formally admits a new member country during 2025.',
    market_slug: 'nato-expansion-2025',
    end_date_iso: future(290),
    tokens: yesNo(0.33, 'demo-politics-003'),
    tags: [{ id: 14, label: 'NATO', slug: 'nato' }, { id: 15, label: 'Geopolitics', slug: 'geopolitics' }],
    active: true, closed: false, archived: false,
    volume: '560000.00', volume_24hr: '9500.00', liquidity: '72000.00',
  },
  {
    condition_id: 'demo-politics-004',
    question: 'Will US inflation (CPI) fall below 2.5% by mid-2025?',
    description: 'Resolves YES if the US CPI YoY rate falls below 2.5% in any month through June 2025.',
    market_slug: 'us-cpi-below-2-5-mid-2025',
    end_date_iso: future(100),
    tokens: yesNo(0.52, 'demo-politics-004'),
    tags: [{ id: 11, label: 'Economy', slug: 'economy' }, { id: 16, label: 'Inflation', slug: 'inflation' }],
    active: true, closed: false, archived: false,
    volume: '1400000.00', volume_24hr: '28000.00', liquidity: '195000.00',
  },

  // ── Sports ───────────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-sports-001',
    question: 'Will the Golden State Warriors make the 2025 NBA Playoffs?',
    description: 'Resolves YES if the Warriors qualify for the 2024-25 NBA playoff bracket.',
    market_slug: 'gsw-nba-playoffs-2025',
    end_date_iso: future(40),
    tokens: yesNo(0.55, 'demo-sports-001'),
    tags: [{ id: 20, label: 'NBA', slug: 'nba' }, { id: 21, label: 'Basketball', slug: 'basketball' }],
    active: true, closed: false, archived: false,
    volume: '820000.00', volume_24hr: '16500.00', liquidity: '115000.00',
  },
  {
    condition_id: 'demo-sports-002',
    question: 'Will Manchester City win the Premier League 2024/25 season?',
    description: 'Resolves YES if Manchester City finishes top of the 2024-25 Premier League table.',
    market_slug: 'man-city-epl-winner-2025',
    end_date_iso: future(55),
    tokens: yesNo(0.41, 'demo-sports-002'),
    tags: [{ id: 22, label: 'Soccer', slug: 'soccer' }, { id: 23, label: 'Premier League', slug: 'premier-league' }],
    active: true, closed: false, archived: false,
    volume: '1100000.00', volume_24hr: '22000.00', liquidity: '162000.00',
  },
  {
    condition_id: 'demo-sports-003',
    question: 'Will Novak Djokovic win the 2025 Wimbledon title?',
    description: 'Resolves YES if Novak Djokovic wins the 2025 Wimbledon gentlemen\'s singles title.',
    market_slug: 'djokovic-wimbledon-2025',
    end_date_iso: future(120),
    tokens: yesNo(0.29, 'demo-sports-003'),
    tags: [{ id: 24, label: 'Tennis', slug: 'tennis' }, { id: 25, label: 'Wimbledon', slug: 'wimbledon' }],
    active: true, closed: false, archived: false,
    volume: '430000.00', volume_24hr: '8200.00', liquidity: '58000.00',
  },

  // ── Events ───────────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-events-001',
    question: 'Will a major earthquake (M7.0+) strike Japan in 2025?',
    description: 'Resolves YES if USGS records a M7.0 or greater earthquake in Japan in 2025.',
    market_slug: 'japan-earthquake-m7-2025',
    end_date_iso: future(280),
    tokens: yesNo(0.68, 'demo-events-001'),
    tags: [{ id: 30, label: 'Natural Disaster', slug: 'natural-disaster' }, { id: 31, label: 'Japan', slug: 'japan' }],
    active: true, closed: false, archived: false,
    volume: '240000.00', volume_24hr: '4800.00', liquidity: '32000.00',
  },
  {
    condition_id: 'demo-events-002',
    question: 'Will GPT-5 be released publicly in 2025?',
    description: 'Resolves YES if OpenAI makes GPT-5 publicly available (not just research preview) in 2025.',
    market_slug: 'gpt5-public-release-2025',
    end_date_iso: future(260),
    tokens: yesNo(0.76, 'demo-events-002'),
    tags: [{ id: 32, label: 'AI', slug: 'ai' }, { id: 33, label: 'OpenAI', slug: 'openai' }],
    active: true, closed: false, archived: false,
    volume: '1750000.00', volume_24hr: '38000.00', liquidity: '270000.00',
  },
  {
    condition_id: 'demo-events-003',
    question: 'Will SpaceX successfully land a Starship on the Moon in 2025?',
    description: 'Resolves YES if SpaceX achieves a successful crewed or uncrewed Starship Moon landing in 2025.',
    market_slug: 'spacex-starship-moon-2025',
    end_date_iso: future(270),
    tokens: yesNo(0.14, 'demo-events-003'),
    tags: [{ id: 34, label: 'SpaceX', slug: 'spacex' }, { id: 35, label: 'Space', slug: 'space' }],
    active: true, closed: false, archived: false,
    volume: '320000.00', volume_24hr: '6000.00', liquidity: '42000.00',
  },

  // ── Entertainment ─────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-entertainment-001',
    question: 'Will a video game adaptation win Best Picture at the 2026 Oscars?',
    description: 'Resolves YES if a movie adapted from a video game wins the Academy Award for Best Picture at the 2026 ceremony.',
    market_slug: 'video-game-movie-best-picture-2026',
    end_date_iso: future(365),
    tokens: yesNo(0.08, 'demo-entertainment-001'),
    tags: [{ id: 40, label: 'Oscars', slug: 'oscars' }, { id: 41, label: 'Movies', slug: 'movies' }],
    active: true, closed: false, archived: false,
    volume: '180000.00', volume_24hr: '3200.00', liquidity: '22000.00',
  },
  {
    condition_id: 'demo-entertainment-002',
    question: 'Will Taylor Swift release a new studio album in 2025?',
    description: 'Resolves YES if Taylor Swift releases a brand new studio album (not a re-recorded "TV" album) in 2025.',
    market_slug: 'taylor-swift-new-album-2025',
    end_date_iso: future(280),
    tokens: yesNo(0.49, 'demo-entertainment-002'),
    tags: [{ id: 42, label: 'Music', slug: 'music' }, { id: 43, label: 'Taylor Swift', slug: 'taylor-swift' }],
    active: true, closed: false, archived: false,
    volume: '690000.00', volume_24hr: '13500.00', liquidity: '94000.00',
  },
  {
    condition_id: 'demo-entertainment-003',
    question: 'Will Netflix exceed 300M paid subscribers by end of 2025?',
    description: 'Resolves YES if Netflix reports 300M or more paid subscribers in its Q4 2025 earnings release.',
    market_slug: 'netflix-300m-subscribers-2025',
    end_date_iso: future(290),
    tokens: yesNo(0.83, 'demo-entertainment-003'),
    tags: [{ id: 44, label: 'Netflix', slug: 'netflix' }, { id: 45, label: 'Streaming', slug: 'streaming' }],
    active: true, closed: false, archived: false,
    volume: '410000.00', volume_24hr: '7800.00', liquidity: '55000.00',
  },

  // ── Other ─────────────────────────────────────────────────────────────────────
  {
    condition_id: 'demo-other-001',
    question: 'Will global average temperature in 2025 break the 2024 record?',
    description: 'Resolves YES if the 2025 annual global surface temperature anomaly (NASA GISS) exceeds the 2024 record.',
    market_slug: 'global-temp-record-2025',
    end_date_iso: future(310),
    tokens: yesNo(0.57, 'demo-other-001'),
    tags: [{ id: 50, label: 'Climate', slug: 'climate' }, { id: 51, label: 'Environment', slug: 'environment' }],
    active: true, closed: false, archived: false,
    volume: '210000.00', volume_24hr: '4100.00', liquidity: '28000.00',
  },
  {
    condition_id: 'demo-other-002',
    question: 'Will global smartphone shipments recover to 2021 levels in 2025?',
    description: 'Resolves YES if IDC reports global smartphone shipments ≥ 1.39B units for full-year 2025.',
    market_slug: 'smartphone-shipments-recovery-2025',
    end_date_iso: future(285),
    tokens: yesNo(0.61, 'demo-other-002'),
    tags: [{ id: 52, label: 'Technology', slug: 'technology' }, { id: 53, label: 'Smartphones', slug: 'smartphones' }],
    active: true, closed: false, archived: false,
    volume: '95000.00', volume_24hr: '1900.00', liquidity: '13000.00',
  },
];
