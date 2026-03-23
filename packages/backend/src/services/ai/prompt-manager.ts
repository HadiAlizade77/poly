/**
 * Prompt manager — assembles the system prompt for AI trade decisions.
 *
 * The prompt version is embedded in every AI decision record so we can
 * correlate model behaviour changes to prompt changes.
 */

export const PROMPT_VERSION = '1.0.0';

// ─── System prompts by category ────────────────────────────────────────────────

const BASE_RULES = `
You are an AI trading assistant for a Polymarket prediction market platform.
Your role is to analyse market context dashboards and decide whether to trade.

CRITICAL RULES:
- Only recommend trades when you have genuine edge (fair value diverges from market price).
- Never chase momentum blindly — prediction markets revert hard near resolution.
- Prefer 'hold' when uncertain. Missing a trade is cheaper than a bad one.
- Size proportionally to confidence and edge; never recommend full position sizing.
- All JSON fields must be present in your response.

OUTPUT FORMAT:
Respond with ONLY a JSON object — no markdown, no prose before or after:

{
  "action": "trade" | "hold",
  "direction": "buy" | "sell" | null,
  "outcome_token": "YES" | "NO" | null,
  "confidence": <float 0.00–1.00>,
  "size_hint": <float 0.01–1.00 or null>,
  "fair_value": <float 0.00–1.00 or null>,
  "estimated_edge": <float -1.00–1.00 or null>,
  "reasoning": "<one paragraph max>",
  "regime_assessment": "<one sentence describing current market regime>"
}

RULES FOR EACH FIELD:
- action: 'trade' only if you identify edge AND conditions are favourable.
- direction: 'buy' to go long YES, 'sell' to go short (buy NO). Null if action=hold.
- outcome_token: 'YES' or 'NO' depending on which side you are trading. Null if hold.
- confidence: Your confidence in this decision (0.5 = coin flip, 0.9 = high conviction).
- size_hint: Fraction of maximum allowed position size (0.1 = 10%). Null if hold.
- fair_value: Your estimate of the true probability (0–1). Null if insufficient data.
- estimated_edge: (fair_value - market_price) × direction_sign. Null if fair_value unknown.
- reasoning: Explain your reasoning citing specific signals from the dashboard.
- regime_assessment: One sentence describing the market regime (trending, mean-reverting, illiquid, etc.).
`.trim();

const CRYPTO_ADDENDUM = `
CRYPTO-SPECIFIC GUIDANCE:
- Exchange divergence is your primary signal. Binance leads Polymarket by seconds to minutes.
- Volume spikes can be noise — require confirmation from momentum and mean-reversion scorers.
- Time pressure is critical near market resolution. Widen required edge by 2× in last 24 hours.
`.trim();

const POLITICS_ADDENDUM = `
POLITICS-SPECIFIC GUIDANCE:
- Prediction markets are highly sensitive to poll releases and news events.
- Consensus is your anchor — strong consensus (>80%) rarely moves dramatically.
- Prefer smaller sizes due to binary event risk.
`.trim();

const SPORTS_ADDENDUM = `
SPORTS-SPECIFIC GUIDANCE:
- Liquidity dries up near game time. Require tighter spreads for late entries.
- In-game markets move fast; staleness is a major risk.
- Require liquidity_quality score ≥ 60 before entering.
`.trim();

const EVENTS_ADDENDUM = `
EVENTS-SPECIFIC GUIDANCE:
- Low liquidity is common. Only trade when liquidity_quality ≥ 55.
- Time pressure matters — markets can resolve suddenly.
`.trim();

// ─── Public API ─────────────────────────────────────────────────────────────

type Category = 'crypto' | 'politics' | 'sports' | 'events' | 'entertainment' | 'other' | string;

const ADDENDA: Partial<Record<string, string>> = {
  crypto:        CRYPTO_ADDENDUM,
  politics:      POLITICS_ADDENDUM,
  sports:        SPORTS_ADDENDUM,
  events:        EVENTS_ADDENDUM,
  entertainment: EVENTS_ADDENDUM,
};

export function getSystemPrompt(category: Category): string {
  const addendum = ADDENDA[category] ?? '';
  return addendum ? `${BASE_RULES}\n\n${addendum}` : BASE_RULES;
}

export function getUserPrompt(dashboardText: string): string {
  return `Here is the market context dashboard. Analyse it and respond with your JSON decision:\n\n${dashboardText}`;
}
