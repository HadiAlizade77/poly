/**
 * Dashboard template for crypto markets.
 *
 * Emphasises price action, on-chain volume, market sentiment, and spread
 * since crypto outcomes are primarily driven by price movements.
 */
import type { DashboardInput } from '../builder.js';
import {
  formatHeader,
  formatSection,
  formatScore,
  formatCurrency,
  formatDaysUntil,
  formatPrices,
  formatAccountState,
  formatFeedback,
} from '../builder.js';

export function buildCryptoDashboard(input: DashboardInput): string {
  const { market, scores, snapshots, bankroll, positions, recentFeedback, sessionFeedback } = input;
  const latestSnap = snapshots[0] as {
    spread?: string | null;
    volume_1h?: string | null;
    liquidity?: string | null;
  } | undefined;

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(formatHeader(`MARKET [CRYPTO]: ${market.title}`));
  lines.push(`Category: ${market.category}  |  Status: ${market.status}  |  Expires: ${formatDaysUntil(market.end_date)}`);
  lines.push(`Liquidity: ${formatCurrency(latestSnap?.liquidity)}  |  Volume 24h: ${formatCurrency(String(market.volume_24h ?? 0))}`);
  if (market.resolution_criteria) {
    lines.push(`Resolution: ${market.resolution_criteria}`);
  }

  // ── Account state ────────────────────────────────────────────────────────────
  lines.push(formatSection('ACCOUNT STATE'));
  lines.push(formatAccountState(bankroll, positions));

  // ── Trade feedback ───────────────────────────────────────────────────────────
  lines.push(formatSection('INTRA-SESSION TRADE FEEDBACK'));
  lines.push(formatFeedback(recentFeedback, sessionFeedback));

  // ── Current prices ───────────────────────────────────────────────────────────
  lines.push(formatSection('CURRENT PRICES'));
  lines.push(formatPrices(market));
  if (latestSnap?.spread) {
    lines.push(`Spread: ${parseFloat(latestSnap.spread).toFixed(4)}`);
  }

  // ── Context scores ───────────────────────────────────────────────────────────
  lines.push(formatSection('CONTEXT SCORES (0=very bearish, 100=very bullish)'));

  const CRYPTO_SCORER_ORDER = [
    'price_momentum',
    'volume_profile',
    'market_sentiment',
    'spread_quality',
    'liquidity_depth',
    'volatility',
    'price_trend',
    'order_flow',
  ];

  // Print scorers in preferred order, then any extras
  const printed = new Set<string>();
  for (const name of CRYPTO_SCORER_ORDER) {
    const dim = scores[name];
    if (dim) {
      lines.push(formatScore(dim.label, dim.value, dim.detail));
      printed.add(name);
    }
  }
  for (const [name, dim] of Object.entries(scores)) {
    if (!printed.has(name)) {
      lines.push(formatScore(dim.label, dim.value, dim.detail));
    }
  }

  if (Object.keys(scores).length === 0) {
    lines.push('(no scorer output available)');
  }

  // ── Composite ────────────────────────────────────────────────────────────────
  const values = Object.values(scores).map((d) => d.value);
  if (values.length > 0) {
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    lines.push('');
    lines.push(`Composite score: ${avg.toFixed(1)}/100  (average of ${values.length} dimensions)`);
  }

  lines.push('═'.repeat(65));
  return lines.join('\n');
}
