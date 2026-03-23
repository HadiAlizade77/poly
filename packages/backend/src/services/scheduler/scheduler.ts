/**
 * Scheduler service.
 *
 * Uses node-cron to run periodic maintenance jobs.
 *
 * Jobs:
 *   - daily-review : 00:05 UTC — bankroll snapshot + trade feedback summaries
 *   - cleanup      : 03:00 UTC — prune old snapshots, scores, external data
 *   - backup       : 02:00 UTC — placeholder for pg_dump / remote backup
 */
import cron from 'node-cron';
import logger from '../../config/logger.js';
import { runDailyReview } from './jobs/daily-review.js';
import { runCleanup }     from './jobs/cleanup.js';
import { runBackup }      from './jobs/backup.js';

// ─── Job registry ─────────────────────────────────────────────────────────────

interface ScheduledJob {
  name:     string;
  schedule: string; // cron expression (UTC)
  fn:       () => Promise<void>;
  task:     cron.ScheduledTask | null;
  running:  boolean;
}

const JOBS: Omit<ScheduledJob, 'task' | 'running'>[] = [
  { name: 'daily-review', schedule: '5 0 * * *',  fn: runDailyReview },
  { name: 'backup',       schedule: '0 2 * * *',  fn: runBackup      },
  { name: 'cleanup',      schedule: '0 3 * * *',  fn: runCleanup     },
];

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class Scheduler {
  private jobs: ScheduledJob[] = JOBS.map((j) => ({ ...j, task: null, running: false }));

  start(): void {
    for (const job of this.jobs) {
      job.task = cron.schedule(job.schedule, () => void this.runJob(job), {
        timezone: 'UTC',
      });
      logger.info('Scheduler: job scheduled', { name: job.name, schedule: job.schedule });
    }
    logger.info('Scheduler: started', { jobs: this.jobs.map((j) => j.name) });
  }

  stop(): void {
    for (const job of this.jobs) {
      job.task?.stop();
      job.task = null;
    }
    logger.info('Scheduler: stopped');
  }

  /** Manually trigger a job by name (for testing / admin). */
  async trigger(jobName: string): Promise<void> {
    const job = this.jobs.find((j) => j.name === jobName);
    if (!job) throw new Error(`Unknown job: ${jobName}`);
    await this.runJob(job);
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    if (job.running) {
      logger.warn('Scheduler: job already running, skipping', { name: job.name });
      return;
    }
    job.running = true;
    const startMs = Date.now();
    logger.info('Scheduler: job starting', { name: job.name });
    try {
      await job.fn();
      logger.info('Scheduler: job complete', { name: job.name, durationMs: Date.now() - startMs });
    } catch (err) {
      logger.error('Scheduler: job failed', {
        name:  job.name,
        error: (err as Error).message,
        durationMs: Date.now() - startMs,
      });
    } finally {
      job.running = false;
    }
  }

  getStatus(): { name: string; schedule: string; running: boolean }[] {
    return this.jobs.map((j) => ({ name: j.name, schedule: j.schedule, running: j.running }));
  }
}

export const scheduler = new Scheduler();
