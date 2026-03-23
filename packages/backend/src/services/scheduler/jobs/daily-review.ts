/**
 * Daily review job.
 *
 * Runs at 00:05 UTC each day:
 *   1. Snapshot today's bankroll balance into bankroll_history
 *   2. Reset balance_delta_today on the bankroll record to 0
 *   3. Generate a TradeFeedback summary per active category
 */
import logger from '../../../config/logger.js';
import * as bankrollService from '../../bankroll.service.js';
import * as tradeFeedbackService from '../../trade-feedback.service.js';
import { snapshotDailyBalance } from '../../bankroll/balance-delta.js';
import { buildSessionFeedback } from '../../decision-engine/feedback/builder.js';

const CATEGORIES = ['crypto', 'politics', 'sports', 'events', 'entertainment'] as const;

export async function runDailyReview(): Promise<void> {
  logger.info('Scheduler: daily-review started');
  const startMs = Date.now();

  try {
    // ── 1. Bankroll snapshot ─────────────────────────────────────────────────
    const bankroll = await bankrollService.get();
    if (bankroll) {
      await snapshotDailyBalance(bankroll);

      // Reset today's delta for the new day
      const b = bankroll as unknown as Record<string, string>;
      await bankrollService.update({
        total_balance:       b.total_balance,
        previous_balance:    b.total_balance, // yesterday's close becomes today's previous
        reserved_balance:    b.reserved_balance ?? '0',
        active_balance:      b.active_balance ?? b.total_balance,
        deployed_balance:    b.deployed_balance ?? '0',
        unrealized_pnl:      b.unrealized_pnl ?? '0',
        balance_delta_today: '0.000000',       // reset for new day
        balance_delta_total: b.balance_delta_total ?? '0',
        initial_deposit:     b.initial_deposit ?? b.total_balance,
      } as Parameters<typeof bankrollService.update>[0]);

      logger.info('Scheduler: bankroll snapshot saved and delta reset');
    } else {
      logger.warn('Scheduler: no bankroll record found — skipping snapshot');
    }

    // ── 2. Session feedback summaries per category ───────────────────────────
    const today = new Date();
    const sessionDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    for (const category of CATEGORIES) {
      try {
        const feedback = await buildSessionFeedback(category);
        if (feedback.decisionsTotal > 0) {
          await tradeFeedbackService.create({
            category,
            session_date:     sessionDate,
            feedback_summary: {
              decisionsTotal:  feedback.decisionsTotal,
              tradeDecisions:  feedback.tradeDecisions,
              holdDecisions:   feedback.holdDecisions,
              vetoed:          feedback.vetoed,
              executed:        feedback.executed,
              avgConfidence:   feedback.avgConfidence,
              currentStreak:   feedback.currentStreak,
              directionalBias: feedback.directionalBias,
              dominantRegime:  feedback.dominantRegime,
              patterns:        feedback.patterns,
            },
            feedback_text: feedback.summaryText,
          });
          logger.info(`Scheduler: trade feedback saved for ${category}`, {
            decisionsTotal: feedback.decisionsTotal,
            executed:       feedback.executed,
          });
        }
      } catch (err) {
        logger.warn(`Scheduler: failed to save feedback for ${category}`, {
          error: (err as Error).message,
        });
      }
    }

  } catch (err) {
    logger.error('Scheduler: daily-review failed', { error: (err as Error).message });
    throw err;
  }

  logger.info('Scheduler: daily-review complete', { durationMs: Date.now() - startMs });
}
