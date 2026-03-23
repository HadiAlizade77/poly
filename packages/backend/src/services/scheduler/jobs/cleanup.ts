/**
 * Cleanup job.
 *
 * Runs at 03:00 UTC each day. Prunes old data to keep the database lean:
 *   - market_snapshots older than 30 days
 *   - context_scores older than 30 days
 *   - external_data_points older than 7 days
 *   - ai_decisions older than 90 days (keep for learning)
 *   - resolved risk_events older than 14 days
 */
import logger from '../../../config/logger.js';
import prisma from '../../../config/database.js';
import * as systemConfigService from '../../system-config.service.js';

interface CleanupLimits {
  snapshotDays:      number;
  contextScoreDays:  number;
  externalDataDays:  number;
  aiDecisionDays:    number;
  riskEventDays:     number;
}

const DEFAULTS: CleanupLimits = {
  snapshotDays:     30,
  contextScoreDays: 30,
  externalDataDays: 7,
  aiDecisionDays:   90,
  riskEventDays:    14,
};

async function loadLimits(): Promise<CleanupLimits> {
  try {
    const val = await systemConfigService.getValue<Partial<CleanupLimits>>('CLEANUP_LIMITS');
    if (val && typeof val === 'object') return { ...DEFAULTS, ...val };
  } catch { /* use defaults */ }
  return { ...DEFAULTS };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export async function runCleanup(): Promise<void> {
  logger.info('Scheduler: cleanup started');
  const startMs = Date.now();
  const limits  = await loadLimits();

  const results: Record<string, number> = {};

  try {
    // ── Market snapshots ─────────────────────────────────────────────────────
    const { count: snapCount } = await prisma.marketSnapshot.deleteMany({
      where: { timestamp: { lt: daysAgo(limits.snapshotDays) } },
    });
    results.market_snapshots = snapCount;

    // ── Context scores ───────────────────────────────────────────────────────
    const { count: scoreCount } = await prisma.contextScore.deleteMany({
      where: { timestamp: { lt: daysAgo(limits.contextScoreDays) } },
    });
    results.context_scores = scoreCount;

    // ── External data points ─────────────────────────────────────────────────
    const { count: extCount } = await prisma.externalDataPoint.deleteMany({
      where: { timestamp: { lt: daysAgo(limits.externalDataDays) } },
    });
    results.external_data_points = extCount;

    // ── AI decisions (keep longer for learning) ───────────────────────────────
    const { count: aiCount } = await prisma.aiDecision.deleteMany({
      where: {
        timestamp:    { lt: daysAgo(limits.aiDecisionDays) },
        was_executed: false,   // only delete non-executed decisions
      },
    });
    results.ai_decisions = aiCount;

    // ── Resolved risk events ─────────────────────────────────────────────────
    const { count: riskCount } = await prisma.riskEvent.deleteMany({
      where: {
        timestamp:     { lt: daysAgo(limits.riskEventDays) },
        auto_resolved: true,
      },
    });
    results.risk_events = riskCount;

    logger.info('Scheduler: cleanup complete', {
      durationMs: Date.now() - startMs,
      deleted:    results,
    });
  } catch (err) {
    logger.error('Scheduler: cleanup failed', { error: (err as Error).message });
    throw err;
  }
}
