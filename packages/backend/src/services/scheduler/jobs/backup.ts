/**
 * Backup job — placeholder.
 *
 * Future: trigger pg_dump to S3 / remote storage.
 * Currently logs a placeholder message and records a system_config heartbeat.
 */
import logger from '../../../config/logger.js';
import * as systemConfigService from '../../system-config.service.js';

export async function runBackup(): Promise<void> {
  logger.info('Scheduler: backup job started (placeholder — no backup target configured)');

  try {
    await systemConfigService.set(
      'LAST_BACKUP_ATTEMPT',
      new Date().toISOString(),
      'Last time the backup job ran (placeholder)',
    );
  } catch {
    // Non-fatal
  }

  logger.info('Scheduler: backup job complete (placeholder)');
}
