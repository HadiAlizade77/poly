import type { Request, Response, NextFunction } from 'express';
import * as riskEventService from '../services/risk-event.service.js';
import * as systemConfigService from '../services/system-config.service.js';
import * as bankrollService from '../services/bankroll.service.js';
import * as tradingStateService from '../services/trading-state.service.js';
import { create as createAuditLog } from '../services/audit-log.service.js';
import type { TradingState } from '../services/trading-state.service.js';
import { emitTradingState } from '../websocket/emit.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { RiskEventType, Severity, RiskScope } from '@prisma/client';

const KILL_SWITCH_KEY = 'KILL_SWITCH_ENABLED';
const AUTOTUNE_ENABLED_KEY = 'AI_RISK_AUTOTUNE_ENABLED';
const AUTOTUNE_BALANCE_KEY = 'AI_RISK_AUTOTUNE_BALANCE';
const RISK_APPETITE_KEY = 'RISK_APPETITE';

// ─── Risk appetite handlers ───────────────────────────────────────────────────

/** GET /api/risk/appetite — return current risk appetite (1-10). */
export async function getRiskAppetite(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const appetite = (await systemConfigService.getValue<number>(RISK_APPETITE_KEY)) ?? 5;
    sendItem(res, { appetite });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/risk/appetite — set risk appetite (1-10). */
export async function setRiskAppetite(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { appetite } = req.body as { appetite: number };

    if (typeof appetite !== 'number' || !Number.isInteger(appetite) || appetite < 1 || appetite > 10) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_APPETITE',
          message: 'appetite must be an integer between 1 and 10',
        },
      });
      return;
    }

    await systemConfigService.set(
      RISK_APPETITE_KEY,
      appetite,
      'Risk appetite scale (1=ultra-conservative, 10=maximum)',
    );

    void createAuditLog(
      'risk_appetite_updated',
      'system_config',
      RISK_APPETITE_KEY,
      { appetite },
      'user',
    ).catch(() => {});

    sendItem(res, { appetite });
  } catch (err) {
    next(err);
  }
}

// ─── Auto-tune helpers ────────────────────────────────────────────────────────

type BalanceTier = 'small' | 'medium' | 'large';

interface RiskParameters {
  max_daily_loss: number;
  max_position_size: number;
  max_total_exposure: number;
  max_single_trade: number;
  max_consecutive_losses: number;
  cooldown_after_loss_streak_minutes: number;
  min_liquidity: number;
  max_spread: number;
  max_latency_ms: number;
  max_data_age_seconds: number;
}

function getBalanceTier(balance: number): BalanceTier {
  if (balance < 100) return 'small';
  if (balance < 1000) return 'medium';
  return 'large';
}

function computeRiskParameters(balance: number): RiskParameters {
  if (balance < 100) {
    return {
      max_daily_loss:                    Math.round(balance * 0.10),
      max_position_size:                 0.15,
      max_total_exposure:                Math.round(balance * 0.60),
      max_single_trade:                  Math.round(balance * 0.10),
      max_consecutive_losses:            3,
      cooldown_after_loss_streak_minutes: 30,
      min_liquidity:                     500,
      max_spread:                        0.08,
      max_latency_ms:                    5000,
      max_data_age_seconds:              300,
    };
  }

  if (balance < 1000) {
    return {
      max_daily_loss:                    Math.round(balance * 0.05),
      max_position_size:                 0.10,
      max_total_exposure:                Math.round(balance * 0.50),
      max_single_trade:                  Math.round(balance * 0.05),
      max_consecutive_losses:            4,
      cooldown_after_loss_streak_minutes: 60,
      min_liquidity:                     1000,
      max_spread:                        0.05,
      max_latency_ms:                    3000,
      max_data_age_seconds:              180,
    };
  }

  return {
    max_daily_loss:                    Math.round(balance * 0.03),
    max_position_size:                 0.05,
    max_total_exposure:                Math.round(balance * 0.40),
    max_single_trade:                  Math.round(balance * 0.03),
    max_consecutive_losses:            5,
    cooldown_after_loss_streak_minutes: 120,
    min_liquidity:                     2000,
    max_spread:                        0.03,
    max_latency_ms:                    2000,
    max_data_age_seconds:              120,
  };
}

export async function listRiskEvents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: riskEventService.RiskEventFilter = {
      ...(req.query.eventType && { eventType: req.query.eventType as RiskEventType }),
      ...(req.query.severity && { severity: req.query.severity as Severity }),
      ...(req.query.marketId && { marketId: String(req.query.marketId) }),
      ...(req.query.resolved !== undefined && {
        resolved: req.query.resolved === 'true',
      }),
      ...(req.query.since && { since: new Date(String(req.query.since)) }),
    };
    const result = await riskEventService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getRiskConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const scope = req.query.scope as RiskScope | undefined;
    const scopeValue = req.query.scope_value as string | undefined;

    if (scope !== undefined) {
      const config = await systemConfigService.getRiskConfig(scope, scopeValue);
      sendItem(res, config);
    } else {
      const configs = await systemConfigService.getAllRiskConfigs();
      sendItem(res, configs);
    }
  } catch (err) {
    next(err);
  }
}

export async function updateRiskConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { scope, scope_value, parameters, updated_by } = req.body as {
      scope: RiskScope;
      scope_value?: string;
      parameters: Record<string, unknown>;
      updated_by?: string;
    };
    const config = await systemConfigService.setRiskConfig(
      scope,
      scope_value,
      parameters,
      updated_by,
    );
    sendItem(res, config);
  } catch (err) {
    next(err);
  }
}

export async function getKillSwitchStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = (await systemConfigService.getValue<boolean>(KILL_SWITCH_KEY)) ?? false;
    sendItem(res, { kill_switch_enabled: enabled });
  } catch (err) {
    next(err);
  }
}

export async function toggleKillSwitch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const current =
      (await systemConfigService.getValue<boolean>(KILL_SWITCH_KEY)) ?? false;
    const next_value = !current;
    await systemConfigService.set(
      KILL_SWITCH_KEY,
      next_value,
      'Global kill switch for all trading',
    );
    void createAuditLog(
      'kill_switch_toggled',
      'system_config',
      KILL_SWITCH_KEY,
      { enabled: next_value },
      'user',
    ).catch(() => {});
    sendItem(res, { kill_switch_enabled: next_value });
  } catch (err) {
    next(err);
  }
}

// ─── Auto-tune handlers ───────────────────────────────────────────────────────

/** GET /api/risk/auto-tune — return current auto-tune status. */
export async function getAutoTuneStatus(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = (await systemConfigService.getValue<boolean>(AUTOTUNE_ENABLED_KEY)) ?? false;
    const lastTunedBalance = await systemConfigService.getValue<number>(AUTOTUNE_BALANCE_KEY);
    sendItem(res, { enabled, lastTunedBalance: lastTunedBalance ?? null });
  } catch (err) {
    next(err);
  }
}

/** POST /api/risk/auto-tune — compute and apply risk parameters from current balance. */
export async function autoTuneRisk(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bankroll = await bankrollService.get();
    const balance = Number(bankroll?.total_balance ?? 0);

    if (balance <= 0) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_BALANCE', message: 'Cannot auto-tune: no balance available' },
      });
      return;
    }

    const parameters = computeRiskParameters(balance);
    const tier = getBalanceTier(balance);

    const updatedConfig = await systemConfigService.setRiskConfig(
      'global' as RiskScope,
      undefined,
      parameters,
      'ai-auto-tune',
    );

    await Promise.all([
      systemConfigService.set(
        AUTOTUNE_ENABLED_KEY,
        true,
        'AI risk auto-tune enabled flag',
      ),
      systemConfigService.set(
        AUTOTUNE_BALANCE_KEY,
        balance,
        'Balance at last AI risk auto-tune',
      ),
    ]);

    void createAuditLog(
      'risk_auto_tuned',
      'risk_config',
      'global',
      { balance, tier, parameters },
      'ai-auto-tune',
    ).catch(() => {});

    sendItem(res, {
      config: updatedConfig,
      parameters,
      balance,
      tier,
      message: `Risk config auto-tuned for $${balance.toFixed(2)} balance (${tier} account)`,
    });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/risk/auto-tune — disable auto-tune. */
export async function disableAutoTune(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await systemConfigService.set(
      AUTOTUNE_ENABLED_KEY,
      false,
      'AI risk auto-tune enabled flag',
    );
    sendItem(res, { enabled: false });
  } catch (err) {
    next(err);
  }
}

// ─── Trading State handlers ──────────────────────────────────────────────────

const VALID_STATES: TradingState[] = ['stopped', 'running', 'paused_all', 'paused_sells'];

/** GET /api/risk/trading-state — return current trading state. */
export async function getTradingState(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const state = await tradingStateService.getState();
    sendItem(res, { state });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/risk/trading-state — change trading state. */
export async function setTradingState(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { state, reason } = req.body as { state: TradingState; reason?: string };

    if (!VALID_STATES.includes(state)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Invalid trading state: ${state}. Must be one of: ${VALID_STATES.join(', ')}`,
        },
      });
      return;
    }

    const newState = await tradingStateService.setState(state, reason);

    // Also sync the kill switch for backward compatibility
    if (state === 'stopped') {
      await systemConfigService.set(KILL_SWITCH_KEY, true, 'Kill switch activated via trading state → stopped');
    } else if (state === 'running') {
      await systemConfigService.set(KILL_SWITCH_KEY, false, 'Kill switch deactivated via trading state → running');
    }

    // Broadcast to all connected clients
    emitTradingState(newState);

    sendItem(res, { state: newState });
  } catch (err) {
    next(err);
  }
}
