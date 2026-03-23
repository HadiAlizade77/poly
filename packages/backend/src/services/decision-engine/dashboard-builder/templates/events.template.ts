/**
 * Dashboard template for events and entertainment markets.
 *
 * Used for: events (AI releases, space launches, disasters, IPOs)
 *           and entertainment (oscars, box office, streaming).
 *
 * Emphasises news recency, sentiment shift, market momentum, and
 * time-sensitivity since these markets often resolve suddenly.
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

export function buildEventsDashboard(input: DashboardInput): string {
  const { market, scores, snapshots, bankroll, positions, recentFeedback, sessionFeedback } = input;
  const latestSnap = snapshots[0] as {
    spread?: string | null;
    liquidity?: string | null;
  } | undefined;

  const categoryLabel = market.category === 'entertainment' ? 'ENTERTAINMENT' : 'EVENTS';

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(formatHeader(`MARKET [${categoryLabel}]: ${market.title}`));
  lines.push(`Status: ${market.status}  |  Expires: ${formatDaysUntil(market.end_date)}`);
  lines.push(`Liquidity: ${formatCurrency(latestSnap?.liquidity)}  |  Volume 24h: ${formatCurrency(String(market.volume_24h ?? 0))}`);
  if (market.resolution_source) {
    lines.push(`Resolution source: ${market.resolution_source}`);
  }
  if (market.resolution_criteria) {
    lines.push(`Criteria: ${market.resolution_criteria}`);
  }

  // ── Account state ────────────────────────────────────────────────────────────
  lines.push(formatSection('ACCOUNT STATE'));
  lines.push(formatAccountState(bankroll, positions));

  // ── Trade feedback ───────────────────────────────────────────────────────────
  lines.push(formatSection('INTRA-SESSION TRADE FEEDBACK'));
  lines.push(formatFeedback(recentFeedback, sessionFeedback));

  // ── Current market prices ────────────────────────────────────────────────────
  lines.push(formatSection('PREDICTION MARKET PRICES'));
  lines.push(formatPrices(market));
  if (latestSnap?.spread) {
    lines.push(`Bid-ask spread: ${parseFloat(latestSnap.spread).toFixed(4)}`);
  }

  // ── Context scores ───────────────────────────────────────────────────────────
  lines.push(formatSection('CONTEXT SCORES (0=strong NO, 100=strong YES)'));

  const EVENTS_SCORER_ORDER = [
    'news_sentiment',
    'news_recency',
    'market_consensus',
    'market_momentum',
    'time_decay',
    'liquidity_depth',
    'volatility',
    'social_signal',
  ];

  const printed = new Set<string>();
  for (const name of EVENTS_SCORER_ORDER) {
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
    lines.push(`Composite score: ${avg.toFixed(1)}/100  (${values.length} dimensions)`);
    lines.push(`Implied YES probability: ${(avg / 100).toFixed(3)}`);
  }

  lines.push('═'.repeat(65));
  return lines.join('\n');
}
