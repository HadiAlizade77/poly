/**
 * Dashboard text builder.
 *
 * Assembles a plain-text LLM prompt section describing a single market's
 * context scores, account state, and recent trade feedback.
 *
 * Plain text (not JSON) is intentional — LLMs reason better over readable prose.
 */
import type { Market, MarketSnapshot, Bankroll, Position, TradeFeedback } from '@prisma/client';
import type { ScoredDimensions } from '../scorer.interface.js';
import { buildCryptoDashboard }        from './templates/crypto.template.js';
import { buildPoliticsDashboard }      from './templates/politics.template.js';
import { buildSportsDashboard }        from './templates/sports.template.js';
import { buildEventsDashboard }        from './templates/events.template.js';
import { buildGenericDashboard }       from './templates/generic.template.js';

// ─── Input type ───────────────────────────────────────────────────────────────

export interface DashboardInput {
  market:          Market;
  scores:          ScoredDimensions;
  snapshots:       MarketSnapshot[];
  bankroll:        Bankroll | null;
  positions:       Position[];
  recentFeedback:  TradeFeedback[];
  /** Rich intra-session feedback text from buildSessionFeedback(). */
  sessionFeedback?: string;
}

// ─── Template dispatch ────────────────────────────────────────────────────────

type TemplateFn = (input: DashboardInput) => string;

const TEMPLATES: Partial<Record<string, TemplateFn>> = {
  crypto:        buildCryptoDashboard,
  politics:      buildPoliticsDashboard,
  sports:        buildSportsDashboard,
  events:        buildEventsDashboard,
  entertainment: buildEventsDashboard,   // reuses events template
};

/**
 * Build the full plain-text dashboard for a market.
 * Dispatches to the category-specific template; falls back to generic.
 */
export function buildDashboard(input: DashboardInput): string {
  const templateFn = TEMPLATES[input.market.category] ?? buildGenericDashboard;
  return templateFn(input);
}

// ─── Shared helpers (used by all templates) ───────────────────────────────────

export function formatHeader(text: string): string {
  const bar = '═'.repeat(65);
  return `${bar}\n${text}\n${bar}`;
}

export function formatSection(title: string): string {
  return `\n── ${title} ${'─'.repeat(Math.max(0, 57 - title.length))}`;
}

export function formatScore(label: string, value: number, detail: string): string {
  const trend  = value >= 65 ? '▲' : value <= 35 ? '▼' : '→';
  const bar    = label.padEnd(22);
  const valStr = `${trend} ${String(Math.round(value)).padStart(2)}/100`;
  return `${bar}${valStr.padEnd(10)}   ${detail}`;
}

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount == null) return 'N/A';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return 'N/A';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDaysUntil(date: Date | null | undefined): string {
  if (!date) return 'no expiry';
  const ms   = date.getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  const hrs  = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days < 0)   return 'expired';
  if (days === 0) return `${hrs}h`;
  return `${days}d ${hrs}h`;
}

export function formatPrices(market: Market): string {
  const prices = market.current_prices as Record<string, number> | null;
  if (!prices) return 'prices unavailable';
  return Object.entries(prices)
    .map(([outcome, price]) => `${outcome}: ${price.toFixed(4)}`)
    .join('  ');
}

export function formatAccountState(
  bankroll: Bankroll | null,
  positions: Position[],
): string {
  const b         = bankroll as { total_balance: unknown; active_balance: unknown; deployed_balance: unknown } | null;
  const balance   = formatCurrency(b?.total_balance != null ? Number(b.total_balance) : null);
  const deployed  = positions.reduce((sum, p) => {
    return sum + Number(p.size) * Number(p.avg_entry_price);
  }, 0);
  const available = b?.active_balance != null
    ? formatCurrency(Number(b.active_balance) - Number(b.deployed_balance ?? 0))
    : 'not set';

  return [
    `Balance:      ${balance}`,
    `Positions:    ${positions.length} open  (${formatCurrency(deployed)} deployed)`,
    `Available:    ${available}`,
  ].join('\n');
}

export function formatFeedback(feedback: TradeFeedback[], sessionFeedback?: string): string {
  const parts: string[] = [];

  // Intra-session stats from the feedback builder (richer, more current)
  if (sessionFeedback) {
    parts.push(sessionFeedback);
  }

  // Historical trade feedback records from the AI review pipeline
  if (feedback.length > 0) {
    const historical = feedback
      .slice(0, 3)
      .map((f) => {
        const date = new Date(f.timestamp).toISOString().slice(0, 10);
        const text = (f.feedback_text ?? '').slice(0, 150);
        return `[${date}] ${f.category}: ${text}`;
      })
      .join('\n');
    if (parts.length > 0) parts.push('\nPrior sessions:');
    parts.push(historical);
  }

  return parts.length > 0 ? parts.join('\n') : '(no trade feedback available)';
}
