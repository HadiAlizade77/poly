/**
 * Session feedback builder.
 *
 * Builds intra-session trading feedback for inclusion in the AI dashboard.
 * Summarises: trades attempted today, win/loss, current streak, directional
 * bias, and regime patterns — giving Claude context on recent performance.
 */
import logger from '../../../config/logger.js';
import prisma from '../../../config/database.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionFeedback {
  category:          string;
  date:              string;        // YYYY-MM-DD
  decisionsTotal:    number;        // AI decisions made today
  tradeDecisions:    number;        // action='trade'
  holdDecisions:     number;        // action='hold'
  vetoed:            number;        // veto_reason not null
  executed:          number;        // was_executed=true
  avgConfidence:     number | null;
  currentStreak:     number;        // +N = winning streak, -N = losing streak
  directionalBias:   'buy' | 'sell' | 'neutral';
  dominantRegime:    string | null;
  patterns:          string[];      // human-readable pattern observations
  summaryText:       string;        // plain text for AI dashboard
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildSessionFeedback(category: string): Promise<SessionFeedback> {
  const today    = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dateStr  = dayStart.toISOString().slice(0, 10);

  try {
    // Fetch today's AI decisions for this category
    const decisions = await prisma.aiDecision.findMany({
      where: {
        category,
        timestamp: { gte: dayStart },
      },
      orderBy: { timestamp: 'desc' },
      take:    100,
      select: {
        action:            true,
        direction:         true,
        confidence:        true,
        veto_reason:       true,
        was_executed:      true,
        regime_assessment: true,
        reasoning:         true,
      },
    });

    if (decisions.length === 0) {
      return emptyFeedback(category, dateStr);
    }

    // ── Aggregates ────────────────────────────────────────────────────────────
    const tradeDecisions  = decisions.filter((d) => d.action === 'trade').length;
    const holdDecisions   = decisions.filter((d) => d.action === 'hold').length;
    const vetoed          = decisions.filter((d) => d.veto_reason !== null).length;
    const executed        = decisions.filter((d) => d.was_executed).length;

    const confidences = decisions
      .map((d) => parseFloat(String(d.confidence)))
      .filter((c) => !isNaN(c));
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

    // ── Directional bias ──────────────────────────────────────────────────────
    const buys  = decisions.filter((d) => d.direction === 'buy').length;
    const sells = decisions.filter((d) => d.direction === 'sell').length;
    let directionalBias: 'buy' | 'sell' | 'neutral' = 'neutral';
    if (buys > sells * 1.5) directionalBias = 'buy';
    else if (sells > buys * 1.5) directionalBias = 'sell';

    // ── Current streak ────────────────────────────────────────────────────────
    // Positive = consecutive successes (executed), negative = consecutive vetoes
    let currentStreak = 0;
    for (const d of decisions) { // newest first
      if (d.was_executed) {
        if (currentStreak >= 0) currentStreak++;
        else break;
      } else if (d.veto_reason !== null) {
        if (currentStreak <= 0) currentStreak--;
        else break;
      }
    }

    // ── Dominant regime ───────────────────────────────────────────────────────
    const regimes = decisions
      .map((d) => d.regime_assessment)
      .filter((r): r is string => r !== null && r.length > 0);
    const dominantRegime = mostFrequent(regimes);

    // ── Pattern detection ─────────────────────────────────────────────────────
    const patterns: string[] = [];

    const vetoRate = tradeDecisions > 0 ? vetoed / tradeDecisions : 0;
    if (vetoRate > 0.7) patterns.push(`High veto rate today (${Math.round(vetoRate * 100)}% of trade signals blocked)`);

    const holdRate = decisions.length > 0 ? holdDecisions / decisions.length : 0;
    if (holdRate > 0.8) patterns.push('AI is predominantly holding — low conviction signals');

    if (avgConfidence !== null && avgConfidence < 0.45) patterns.push('Low average confidence — market conditions unclear');
    if (avgConfidence !== null && avgConfidence > 0.75) patterns.push('High average confidence — clear directional signals');

    if (currentStreak <= -3) patterns.push(`Consecutive veto streak: ${Math.abs(currentStreak)} — check risk governor thresholds`);
    if (currentStreak >= 3)  patterns.push(`Consecutive execution streak: ${currentStreak} — positive momentum`);

    if (directionalBias !== 'neutral') {
      patterns.push(`Strong ${directionalBias} bias today (${directionalBias === 'buy' ? buys : sells} vs ${directionalBias === 'buy' ? sells : buys})`);
    }

    // ── Summary text ──────────────────────────────────────────────────────────
    const summaryText = buildSummaryText({
      category, date: dateStr, dateStr, decisionsTotal: decisions.length,
      tradeDecisions, holdDecisions, vetoed, executed,
      avgConfidence, currentStreak, directionalBias, dominantRegime, patterns,
    });

    return {
      category,
      date:           dateStr,
      decisionsTotal: decisions.length,
      tradeDecisions,
      holdDecisions,
      vetoed,
      executed,
      avgConfidence,
      currentStreak,
      directionalBias,
      dominantRegime,
      patterns,
      summaryText,
    };
  } catch (err) {
    logger.warn('SessionFeedback: failed to build feedback', {
      category,
      error: (err as Error).message,
    });
    return emptyFeedback(category, dateStr);
  }
}

// ─── Text formatter ───────────────────────────────────────────────────────────

function buildSummaryText(f: Omit<SessionFeedback, 'summaryText'> & { dateStr: string }): string {
  const lines: string[] = [];

  lines.push(`Session: ${f.dateStr} · ${f.category}`);
  lines.push(`Decisions: ${f.decisionsTotal} total (${f.tradeDecisions} trade signals, ${f.holdDecisions} holds)`);
  lines.push(`Execution: ${f.executed} executed, ${f.vetoed} vetoed by risk governor`);

  if (f.avgConfidence !== null) {
    lines.push(`Avg confidence: ${(f.avgConfidence * 100).toFixed(1)}%`);
  }

  const streakStr = f.currentStreak > 0
    ? `+${f.currentStreak} (execution streak)`
    : f.currentStreak < 0
      ? `${f.currentStreak} (veto streak)`
      : '0 (neutral)';
  lines.push(`Current streak: ${streakStr}`);

  lines.push(`Directional bias: ${f.directionalBias}`);

  if (f.dominantRegime) {
    lines.push(`Dominant regime: ${f.dominantRegime}`);
  }

  if (f.patterns.length > 0) {
    lines.push('Patterns:');
    for (const p of f.patterns) lines.push(`  · ${p}`);
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyFeedback(category: string, date: string): SessionFeedback {
  return {
    category,
    date,
    decisionsTotal: 0,
    tradeDecisions: 0,
    holdDecisions:  0,
    vetoed:         0,
    executed:       0,
    avgConfidence:  null,
    currentStreak:  0,
    directionalBias: 'neutral',
    dominantRegime:  null,
    patterns:        [],
    summaryText:     `Session: ${date} · ${category}\nNo decisions recorded today.`,
  };
}

function mostFrequent(items: string[]): string | null {
  if (items.length === 0) return null;
  const freq = new Map<string, number>();
  for (const item of items) freq.set(item, (freq.get(item) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [key, count] of freq) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
}
