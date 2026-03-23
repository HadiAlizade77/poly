/**
 * Finds active "Bitcoin Up or Down" 5-minute markets from the markets table.
 *
 * After locating a candidate, fetches fresh YES/NO prices from the
 * Polymarket CLOB so the bot trades on up-to-date quotes.
 */
import prisma from '../../config/database.js';
import logger from '../../config/logger.js';
import { PolymarketClient } from '../../integrations/polymarket/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActiveBtcMarket {
  id: string;
  polymarket_id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  yesTokenId: string;
  noTokenId: string;
  endDate: Date | null;
  liquidity: number;
  volume24h: number;
}

// ─── Outcome shape stored in market.outcomes JSON ────────────────────────────

interface OutcomeEntry {
  token_id?: string;
  tokenId?:  string;
  id?:       string;
  name?:     string;
  label?:    string;
  price?:    number;
}

// ─── Polymarket client singleton for price refresh ──────────────────────────

const polyClient = new PolymarketClient(process.env.POLYMARKET_API_KEY);

// ─── Main export ─────────────────────────────────────────────────────────────

export async function findActiveBtcMarket(): Promise<ActiveBtcMarket | null> {
  // Pull candidates with a broad DB filter; apply title matching in JS
  // because Prisma doesn't support multi-term case-insensitive AND easily.
  //
  // Fetch up to 500 candidates (increased from 100) to avoid missing
  // 5-min markets that are interleaved with many other active markets.
  const candidates = await prisma.market.findMany({
    where: {
      status:       'active',
      is_tradeable: true,
    },
    orderBy: { end_date: 'asc' },
    take: 500,
  });

  // Match markets where:
  //   - Title contains a BTC keyword AND
  //   - Title contains a 5-min keyword OR an up/down keyword (some Polymarket titles omit "5 min")
  //   - end_date is in the future but within the next 10 minutes (active 5-min window only)
  const fiveMinPatterns = ['5 min', '5-min', '5 minute', '5min'];
  const btcPatterns     = ['bitcoin', 'btc'];
  const upDownPatterns  = ['up or down', 'up/down', 'higher or lower'];

  const now          = new Date();
  const tenMinFromNow = new Date(now.getTime() + 10 * 60_000);

  const match = candidates.find((m) => {
    const lower   = m.title.toLowerCase();
    const hasBtc  = btcPatterns.some((p) => lower.includes(p));
    const has5m   = fiveMinPatterns.some((p) => lower.includes(p));
    const hasUpDown = upDownPatterns.some((p) => lower.includes(p));

    if (!hasBtc || (!has5m && !hasUpDown)) return false;

    // Require end_date to be within the current (or imminent) 5-min window.
    // This prevents accidentally matching long-dated BTC markets whose title
    // happens to include "up or down".
    if (m.end_date) {
      const endDate = new Date(m.end_date);
      if (endDate <= now || endDate > tenMinFromNow) return false;
    }

    return true;
  });

  if (!match) {
    logger.debug('BtcMarketFinder: no active BTC 5-min market found');
    return null;
  }

  // Parse outcomes JSON to extract YES/NO token IDs and prices
  const outcomes = (match.outcomes ?? []) as OutcomeEntry[];
  const prices   = (match.current_prices ?? {}) as Record<string, number>;

  // Attempt to find YES/NO entries
  const yesEntry = outcomes.find(
    (o) => (o.name ?? o.label ?? '').toUpperCase() === 'YES',
  );
  const noEntry = outcomes.find(
    (o) => (o.name ?? o.label ?? '').toUpperCase() === 'NO',
  );

  const yesTokenId = yesEntry?.token_id ?? yesEntry?.tokenId ?? yesEntry?.id ?? 'YES';
  const noTokenId  = noEntry?.token_id  ?? noEntry?.tokenId  ?? noEntry?.id  ?? 'NO';

  // Resolve prices — start with DB values, then try position-based fallback
  const priceValues = Object.values(prices);
  let yesPrice =
    prices[yesTokenId] ?? yesEntry?.price ?? priceValues[0] ?? 0.5;
  let noPrice =
    prices[noTokenId] ?? noEntry?.price ?? priceValues[1] ?? (1 - yesPrice);

  // Refresh prices from Polymarket CLOB for fresh quotes
  try {
    const [freshYes, freshNo] = await Promise.all([
      polyClient.getPrice(yesTokenId),
      polyClient.getPrice(noTokenId),
    ]);
    if (freshYes !== null) yesPrice = freshYes;
    if (freshNo !== null)  noPrice  = freshNo;
  } catch (err) {
    logger.warn('BtcMarketFinder: failed to refresh prices from CLOB, using DB values', {
      error: (err as Error).message,
    });
  }

  logger.debug('BtcMarketFinder: found market', {
    id:    match.id,
    title: match.title,
    yesPrice,
    noPrice,
    endDate: match.end_date,
  });

  return {
    id:            match.id,
    polymarket_id: match.polymarket_id,
    title:         match.title,
    yesPrice,
    noPrice,
    yesTokenId,
    noTokenId,
    endDate:   match.end_date ? new Date(match.end_date) : null,
    liquidity: Number(match.liquidity ?? 0),
    volume24h: Number(match.volume_24h ?? 0),
  };
}
