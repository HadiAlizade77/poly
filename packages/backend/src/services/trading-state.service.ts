/**
 * Trading State Service
 *
 * Manages the global trading state: stopped, running, paused_all, paused_sells.
 * Persisted in system_config table under key 'TRADING_STATE'.
 * In-memory cache with 10s TTL for fast reads.
 *
 * States:
 *   - stopped:       Nothing runs. Scanner still collects data but no decisions or executions.
 *   - running:       Full pipeline active — scanning, decisions, execution, exits.
 *   - paused_all:    Everything paused — no new decisions, no exits (positions stay open).
 *   - paused_sells:  New buys allowed, but no sell orders and no automatic exits.
 */
import logger from '../config/logger.js';
import * as systemConfigService from './system-config.service.js';
import { create as createAuditLog } from './audit-log.service.js';

export type TradingState = 'stopped' | 'running' | 'paused_all' | 'paused_sells';

const CONFIG_KEY = 'TRADING_STATE';
const CACHE_TTL = 10_000; // 10s

// ─── In-memory cache ─────────────────────────────────────────────────────────

let _state: TradingState = 'stopped';
let _lastChecked = 0;

// ─── Public API ──────────────────────────────────────────────────────────────

/** Get the current trading state (cached, reads from DB at most every CACHE_TTL). */
export async function getState(): Promise<TradingState> {
  if (Date.now() - _lastChecked < CACHE_TTL) return _state;

  try {
    const val = await systemConfigService.getValue<TradingState>(CONFIG_KEY);
    if (val && isValidState(val)) {
      _state = val;
    }
    _lastChecked = Date.now();
  } catch {
    // DB unavailable — keep cached value
  }

  return _state;
}

/** Get the cached state synchronously (for hot-path checks). */
export function getStateSync(): TradingState {
  return _state;
}

/** Set trading state and persist to DB. */
export async function setState(newState: TradingState, reason?: string): Promise<TradingState> {
  const oldState = _state;
  _state = newState;
  _lastChecked = Date.now();

  try {
    await systemConfigService.set(
      CONFIG_KEY,
      newState,
      `Trading state: ${newState}${reason ? ` — ${reason}` : ''}`,
    );
    await createAuditLog(
      'set_trading_state',
      'system_config',
      CONFIG_KEY,
      { oldState, newState, reason },
    );
    logger.info('TradingState: changed', { oldState, newState, reason });
  } catch (err) {
    logger.error('TradingState: failed to persist', {
      newState,
      error: (err as Error).message,
    });
    // Keep in-memory state even if DB write fails
  }

  return newState;
}

/** Check if the system allows new trading decisions (buy & sell). */
export async function canTrade(): Promise<boolean> {
  const state = await getState();
  return state === 'running';
}

/** Check if sells / position exits are allowed. */
export async function canSell(): Promise<boolean> {
  const state = await getState();
  return state === 'running';
  // paused_sells and paused_all both block sells; stopped blocks everything
}

/** Check if the scanner should collect market data. */
export async function canScan(): Promise<boolean> {
  const state = await getState();
  // Scanner runs in all states except 'stopped'
  return state !== 'stopped';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidState(val: string): val is TradingState {
  return ['stopped', 'running', 'paused_all', 'paused_sells'].includes(val);
}

/** Initialize cache from DB on startup. */
export async function initialize(): Promise<void> {
  try {
    const val = await systemConfigService.getValue<TradingState>(CONFIG_KEY);
    if (val && isValidState(val)) {
      _state = val;
    } else {
      // First boot — default to stopped, persist it
      await systemConfigService.set(CONFIG_KEY, 'stopped', 'Initial trading state');
      _state = 'stopped';
    }
    _lastChecked = Date.now();
    logger.info('TradingState: initialized', { state: _state });
  } catch (err) {
    logger.warn('TradingState: DB unavailable at init, defaulting to stopped', {
      error: (err as Error).message,
    });
  }
}
