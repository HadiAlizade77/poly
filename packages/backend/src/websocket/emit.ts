/**
 * Typed WebSocket emit helpers.
 * Services import these to push real-time updates to connected clients.
 *
 * Usage:
 *   import { emitMarketUpdate } from '../websocket/emit.js';
 *   await emitMarketUpdate(marketId, updatedMarket);
 */
import { getIO } from './server.js';
import { WS_CHANNELS, type WsEventMap } from './channels.js';
import logger from '../config/logger.js';

function emit<C extends keyof WsEventMap>(channel: C, data: WsEventMap[C]): void {
  try {
    getIO().to(channel).emit(channel, data);
  } catch {
    // WebSocket server not yet initialized (e.g. during tests) — safe to ignore
    logger.debug('WebSocket emit skipped (server not ready)', { channel });
  }
}

export function emitMarketUpdate(
  marketId: string,
  data: unknown,
): void {
  emit(WS_CHANNELS.MARKET_UPDATE, { marketId, data });
}

export function emitScoreUpdate(
  marketId: string,
  category: string,
  scores: unknown,
): void {
  emit(WS_CHANNELS.SCORE_UPDATE, { marketId, category, scores });
}

export function emitDecisionNew(
  decisionId: string,
  marketId: string,
  action: string,
  data: unknown,
): void {
  emit(WS_CHANNELS.DECISION_NEW, { decisionId, marketId, action, data });
}

export function emitOrderUpdate(orderId: string, status: string, data: unknown): void {
  emit(WS_CHANNELS.ORDER_UPDATE, { orderId, status, data });
}

export function emitPositionUpdate(
  positionId: string,
  marketId: string,
  data: unknown,
): void {
  emit(WS_CHANNELS.POSITION_UPDATE, { positionId, marketId, data });
}

export function emitRiskEvent(
  eventType: string,
  severity: string,
  data: unknown,
): void {
  emit(WS_CHANNELS.RISK_EVENT, { eventType, severity, data });
}

export function emitAlertNew(
  alertId: string,
  alertType: string,
  severity: string,
  data: unknown,
): void {
  emit(WS_CHANNELS.ALERT_NEW, { alertId, alertType, severity, data });
}

export function emitBankrollUpdate(data: unknown): void {
  emit(WS_CHANNELS.BANKROLL_UPDATE, { data });
}

export function emitSystemHealth(): void {
  emit(WS_CHANNELS.SYSTEM_HEALTH, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
