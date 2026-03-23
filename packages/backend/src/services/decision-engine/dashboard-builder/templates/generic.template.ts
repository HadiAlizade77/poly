/**
 * Generic fallback dashboard template for uncategorised or "other" markets.
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

export function buildGenericDashboard(input: DashboardInput): string {
  const { market, scores, snapshots, bankroll, positions, recentFeedback, sessionFeedback } = input;
  const latestSnap = snapshots[0] as { spread?: string | null; liquidity?: string | null } | undefined;

  const lines: string[] = [];

  lines.push(formatHeader(`MARKET: ${market.title}`));
  lines.push(`Category: ${market.category}  |  Status: ${market.status}  |  Expires: ${formatDaysUntil(market.end_date)}`);
  lines.push(`Liquidity: ${formatCurrency(latestSnap?.liquidity)}  |  Volume 24h: ${formatCurrency(String(market.volume_24h ?? 0))}`);
  if (market.resolution_criteria) lines.push(`Resolution: ${market.resolution_criteria}`);

  lines.push(formatSection('ACCOUNT STATE'));
  lines.push(formatAccountState(bankroll, positions));

  lines.push(formatSection('INTRA-SESSION TRADE FEEDBACK'));
  lines.push(formatFeedback(recentFeedback, sessionFeedback));

  lines.push(formatSection('CURRENT PRICES'));
  lines.push(formatPrices(market));
  if (latestSnap?.spread) lines.push(`Spread: ${parseFloat(latestSnap.spread).toFixed(4)}`);

  lines.push(formatSection('CONTEXT SCORES'));
  for (const [, dim] of Object.entries(scores)) {
    lines.push(formatScore(dim.label, dim.value, dim.detail));
  }
  if (Object.keys(scores).length === 0) lines.push('(no scorer output available)');

  const values = Object.values(scores).map((d) => d.value);
  if (values.length > 0) {
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    lines.push(`\nComposite score: ${avg.toFixed(1)}/100`);
  }

  lines.push('═'.repeat(65));
  return lines.join('\n');
}
