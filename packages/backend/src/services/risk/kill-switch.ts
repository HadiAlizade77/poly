/**
 * Kill switch — global trading halt.
 *
 * Backed by system_config key 'KILL_SWITCH_ENABLED'.
 * Also reads the KILL_SWITCH_ENABLED env var at startup as override.
 *
 * The in-memory flag is a fast-path cache; truth is always the DB.
 */
import logger from '../../config/logger.js';
import * as systemConfigService from '../system-config.service.js';

// ─── In-memory cache ─────────────────────────────────────────────────────────

// True when trading is halted globally
let _active      = process.env.KILL_SWITCH_ENABLED === 'true';
let _reason      = process.env.KILL_SWITCH_ENABLED === 'true' ? 'env override at startup' : '';
let _lastChecked = 0;
const CACHE_TTL  = 30_000; // re-read DB every 30 s

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if trading is globally halted.
 * Reads from DB at most once per CACHE_TTL.
 */
export async function isActive(): Promise<boolean> {
  if (Date.now() - _lastChecked < CACHE_TTL) return _active;

  try {
    const val = await systemConfigService.getValue<boolean>('KILL_SWITCH_ENABLED');
    _active      = val === true;
    _lastChecked = Date.now();
  } catch {
    // DB unavailable — keep cached value
  }

  return _active;
}

/** Activate the kill switch and persist to DB. */
export async function activate(reason: string): Promise<void> {
  _active  = true;
  _reason  = reason;
  _lastChecked = Date.now();

  try {
    await systemConfigService.set('KILL_SWITCH_ENABLED', true, `Kill switch activated: ${reason}`);
    logger.error('KillSwitch: ACTIVATED', { reason });
  } catch (err) {
    logger.error('KillSwitch: failed to persist activation', { reason, error: (err as Error).message });
    // Still keep in-memory flag active
  }
}

/** Deactivate the kill switch. */
export async function deactivate(): Promise<void> {
  _active      = false;
  _reason      = '';
  _lastChecked = Date.now();

  try {
    await systemConfigService.set('KILL_SWITCH_ENABLED', false, 'Kill switch deactivated');
    logger.info('KillSwitch: deactivated');
  } catch (err) {
    logger.error('KillSwitch: failed to persist deactivation', { error: (err as Error).message });
  }
}

/** Current kill switch state (from cache). */
export function getState(): { active: boolean; reason: string } {
  return { active: _active, reason: _reason };
}
