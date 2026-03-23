import { describe, it, expect } from 'vitest';
import { classifyMarket } from '../../../src/services/market-scanner/classifier.js';

// ─── Crypto ───────────────────────────────────────────────────────────────────

describe('classifyMarket – crypto', () => {
  it('classifies BTC title as crypto', () => {
    expect(classifyMarket('Will BTC close above $70k?')).toBe('crypto');
  });

  it('classifies Bitcoin title as crypto', () => {
    expect(classifyMarket('Will Bitcoin break its all-time high in 2025?')).toBe('crypto');
  });

  it('classifies Ethereum title as crypto', () => {
    expect(classifyMarket('Will Ethereum hit $5,000 this year?')).toBe('crypto');
  });

  it('classifies via crypto keyword in description', () => {
    expect(classifyMarket('Unknown market', 'Resolves based on crypto exchange volumes.')).toBe(
      'crypto',
    );
  });

  it('classifies via ETH tag label', () => {
    expect(
      classifyMarket('Price prediction', undefined, [{ label: 'Ethereum', slug: 'eth' }]),
    ).toBe('crypto');
  });

  it('classifies Solana title as crypto', () => {
    expect(classifyMarket('Will Solana flip Ethereum by market cap?')).toBe('crypto');
  });

  it('classifies DeFi title as crypto', () => {
    expect(classifyMarket('Will total DeFi TVL exceed $200B in 2025?')).toBe('crypto');
  });

  it('classifies token title as crypto', () => {
    expect(classifyMarket('Will this token reach $1?')).toBe('crypto');
  });
});

// ─── Politics ─────────────────────────────────────────────────────────────────

describe('classifyMarket – politics', () => {
  it('classifies election title as politics', () => {
    expect(classifyMarket('Who will win the 2026 US midterm election?')).toBe('politics');
  });

  it('classifies president title as politics', () => {
    expect(classifyMarket('Will the president sign the bill?')).toBe('politics');
  });

  it('classifies Fed rate title as politics', () => {
    expect(classifyMarket('Will the Federal Reserve cut interest rates in March?')).toBe('politics');
  });

  it('classifies inflation title as politics', () => {
    expect(classifyMarket('Will US inflation fall below 2.5%?')).toBe('politics');
  });

  it('classifies shutdown title as politics', () => {
    expect(classifyMarket('US government shutdown in 2025?')).toBe('politics');
  });

  it('classifies war title as politics', () => {
    expect(classifyMarket('Will the war in Ukraine end with a ceasefire?')).toBe('politics');
  });

  it('classifies NATO title as politics', () => {
    expect(classifyMarket('Will NATO expand to include a new member?')).toBe('politics');
  });

  it('classifies senate title as politics', () => {
    expect(classifyMarket('Will the senate pass the new legislation?')).toBe('politics');
  });
});

// ─── Sports ───────────────────────────────────────────────────────────────────

describe('classifyMarket – sports', () => {
  it('classifies Lakers NBA championship as sports', () => {
    expect(classifyMarket('Will the Lakers win the NBA Championship?')).toBe('sports');
  });

  it('classifies NFL title as sports', () => {
    expect(classifyMarket('Who will win Super Bowl LX?')).toBe('sports');
  });

  it('classifies soccer title as sports', () => {
    expect(classifyMarket('Will Manchester City win the Premier League?')).toBe('sports');
  });

  it('classifies Wimbledon title as sports', () => {
    expect(classifyMarket('Will Djokovic win Wimbledon 2025?')).toBe('sports');
  });

  it('classifies Formula 1 title as sports', () => {
    expect(classifyMarket('Will Verstappen win the Formula 1 championship again?')).toBe('sports');
  });

  it('classifies UFC title as sports', () => {
    expect(classifyMarket('UFC 300 main event winner prediction')).toBe('sports');
  });

  it('classifies World Cup title as sports', () => {
    expect(classifyMarket('Which team will win the 2026 World Cup?')).toBe('sports');
  });

  it('classifies via sports tag', () => {
    expect(classifyMarket('Championship outcome', undefined, ['nba', 'basketball'])).toBe('sports');
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe('classifyMarket – events', () => {
  it('classifies earthquake title as events', () => {
    expect(classifyMarket('Will a major earthquake strike Japan in 2025?')).toBe('events');
  });

  it('classifies AI title as events', () => {
    expect(classifyMarket('Will OpenAI announce GPT-5 in 2025?')).toBe('events');
  });

  it('classifies SpaceX title as events', () => {
    expect(classifyMarket('Will SpaceX land Starship on the Moon?')).toBe('events');
  });

  it('classifies pandemic title as events', () => {
    expect(classifyMarket('Will a new pandemic be declared in 2025?')).toBe('events');
  });

  it('classifies IPO title as events', () => {
    expect(classifyMarket('Will OpenAI launch an IPO in 2025?')).toBe('events');
  });
});

// ─── Entertainment ────────────────────────────────────────────────────────────

describe('classifyMarket – entertainment', () => {
  it('classifies Oscar title as entertainment', () => {
    expect(classifyMarket('Which film will win the Oscar for Best Picture?')).toBe('entertainment');
  });

  it('classifies Grammy title as entertainment', () => {
    expect(classifyMarket('Who will win the Grammy for Album of the Year?')).toBe('entertainment');
  });

  it('classifies Netflix title as entertainment', () => {
    expect(classifyMarket('Will Netflix exceed 300M subscribers by 2025?')).toBe('entertainment');
  });

  it('classifies box office title as entertainment', () => {
    expect(classifyMarket('Will this film break box office records?')).toBe('entertainment');
  });

  it('classifies music album title as entertainment', () => {
    expect(classifyMarket('Will Taylor Swift release a new album in 2025?')).toBe('entertainment');
  });
});

// ─── Other ────────────────────────────────────────────────────────────────────

describe('classifyMarket – other', () => {
  it('returns other for unrecognized title', () => {
    expect(classifyMarket('Random unknown market with no keywords')).toBe('other');
  });

  it('returns other for empty title', () => {
    expect(classifyMarket('')).toBe('other');
  });

  it('returns other for title with special chars only', () => {
    expect(classifyMarket('???')).toBe('other');
  });

  it('returns other for climate topic (not in any category)', () => {
    expect(classifyMarket('Will global average temperature break the 2024 record?')).toBe('other');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('classifyMarket – edge cases', () => {
  it('is case insensitive', () => {
    expect(classifyMarket('BITCOIN PRICE PREDICTION')).toBe('crypto');
    expect(classifyMarket('ELECTION WINNER 2026')).toBe('politics');
    expect(classifyMarket('NBA CHAMPIONSHIP')).toBe('sports');
  });

  it('ignores punctuation in title', () => {
    expect(classifyMarket('BTC/USD: will it reach $100k?')).toBe('crypto');
  });

  it('crypto wins over other categories (crypto checked first)', () => {
    // "exchange" is a crypto keyword; even if it also sounds like events
    expect(classifyMarket('Will the stock exchange crash during the war?')).toBe('crypto');
  });

  it('politics wins over entertainment when checked before it', () => {
    // "inflation" (politics) appears before any entertainment keyword
    expect(classifyMarket('Grammy awards amid high inflation backdrop')).toBe('politics');
  });

  it('uses description when title has no keywords', () => {
    expect(
      classifyMarket(
        'Market prediction',
        'The NBA basketball playoff outcomes determine this.',
      ),
    ).toBe('sports');
  });

  it('uses tag text when title and description have no keywords', () => {
    expect(
      classifyMarket('Price prediction', undefined, [
        { label: 'Tennis', slug: 'tennis' },
        { label: 'Wimbledon', slug: 'wimbledon' },
      ]),
    ).toBe('sports');
  });

  it('handles string tags (not just objects)', () => {
    expect(classifyMarket('Unknown', undefined, ['ethereum', 'solana'])).toBe('crypto');
  });

  it('handles tag with slug only (no label)', () => {
    expect(classifyMarket('Unknown', undefined, [{ slug: 'bitcoin' }])).toBe('crypto');
  });

  it('handles tag with label only (no slug)', () => {
    expect(classifyMarket('Unknown', undefined, [{ label: 'Oscars' }])).toBe('entertainment');
  });

  it('handles empty tags array', () => {
    expect(classifyMarket('Random market', undefined, [])).toBe('other');
  });

  it('handles undefined description and tags', () => {
    expect(classifyMarket('Will Bitcoin crash?')).toBe('crypto');
  });
});
