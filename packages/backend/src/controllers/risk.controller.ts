import type { Request, Response, NextFunction } from 'express';
import * as riskEventService from '../services/risk-event.service.js';
import * as systemConfigService from '../services/system-config.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { RiskEventType, Severity, RiskScope } from '@prisma/client';

const KILL_SWITCH_KEY = 'KILL_SWITCH_ENABLED';

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
    sendItem(res, { kill_switch_enabled: next_value });
  } catch (err) {
    next(err);
  }
}
