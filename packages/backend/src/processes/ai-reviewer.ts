/**
 * PM2 entry point for the AI Reviewer process.
 *
 * Lifecycle:
 *   start → connect DB + Redis → run periodic review loop → run until SIGTERM/SIGINT
 *
 * Responsibilities:
 *   - Periodically scan for pending AI review decisions in the `ai_reviews` table
 *   - Log counts of unapplied reviews by type for observability
 *   - Publish a heartbeat to Redis so the API and monitoring can confirm liveness
 *
 * This process does NOT call the Anthropic API directly. Reviews are created
 * by the decision engine and scheduled jobs; this process surfaces them and
 * could trigger downstream actions in future iterations.
 *
 * Configure the poll interval via AI_REVIEWER_INTERVAL_MS (default: 60 000 ms).
 */
import 'dotenv/config';
import logger from '../config/logger.js';
import { disconnectDatabase, prisma } from '../config/database.js';
import { redis } from '../config/redis.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const INTERVAL_MS = parseInt(process.env.AI_REVIEWER_INTERVAL_MS ?? '60000', 10);
const HEARTBEAT_KEY = 'process:ai-reviewer:heartbeat';

// ─── State ────────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

// ─── Core loop ────────────────────────────────────────────────────────────────

async function processPendingReviews(): Promise<void> {
  if (isShuttingDown) return;

  try {
    // Count unapplied reviews grouped by type for observability
    const pending = await prisma.aiReview.groupBy({
      by: ['review_type'],
      where: { was_applied: false },
      _count: { id: true },
    });

    const totalPending = pending.reduce((sum, row) => sum + row._count.id, 0);

    if (totalPending > 0) {
      const breakdown = Object.fromEntries(
        pending.map((row) => [row.review_type, row._count.id]),
      );

      logger.info('AI Reviewer: pending reviews detected', {
        total:     totalPending,
        breakdown,
      });
    } else {
      logger.debug('AI Reviewer: no pending reviews');
    }

    // Publish heartbeat so monitoring knows the process is alive
    await redis.set(HEARTBEAT_KEY, Date.now(), 'EX', Math.ceil((INTERVAL_MS * 3) / 1000));
  } catch (err) {
    logger.error('AI Reviewer: error during review scan', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

logger.info('AI Reviewer process starting', {
  pid:        process.pid,
  intervalMs: INTERVAL_MS,
});

// Run immediately on start, then on the configured interval
void processPendingReviews();
intervalHandle = setInterval(() => void processPendingReviews(), INTERVAL_MS);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`AI Reviewer: received ${signal}, shutting down`);
  isShuttingDown = true;

  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('AI Reviewer: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('AI Reviewer: error during shutdown', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('AI Reviewer: uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('AI Reviewer: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});
