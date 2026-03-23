/**
 * Typed WebSocket emit helpers.
 * Services import these to push real-time updates to connected clients.
 *
 * When running inside the api-server process (Socket.IO available), emits directly.
 * When running in a worker process (market-scanner, decision-engine, etc.),
 * publishes via Redis so the api-server can forward to WebSocket clients.
 */
import { getIO } from './server.js';
import { WS_CHANNELS, type WsEventMap } from './channels.js';
import logger from '../config/logger.js';

const WS_BRIDGE_PREFIX = 'ws-bridge:';

function emit<C extends keyof WsEventMap>(channel: C, data: WsEventMap[C]): void {
  try {
    getIO().to(channel).emit(channel, data);
  } catch {
    // Not in api-server process — publish via Redis for the bridge
    publishViaBridge(channel, data);
  }
}

let bridgePublishFn: ((channel: string, data: unknown) => Promise<void>) | null = null;

async function loadBridgePublish(): Promise<(channel: string, data: unknown) => Promise<void>> {
  const { publish } = await import('../utils/redis.js');
  return publish;
}

function publishViaBridge(channel: string, data: unknown): void {
  if (bridgePublishFn) {
    void bridgePublishFn(`${WS_BRIDGE_PREFIX}${channel}`, data).catch(() => {});
    return;
  }
  void loadBridgePublish()
    .then((fn) => {
      bridgePublishFn = fn;
      return fn(`${WS_BRIDGE_PREFIX}${channel}`, data);
    })
    .catch(() => {});
}

/**
 * Called by the api-server on startup to subscribe to Redis bridge channels
 * and forward them to Socket.IO clients.
 */
export async function startWsBridge(): Promise<void> {
  const { subscribe } = await import('../utils/redis.js');
  const channels = Object.values(WS_CHANNELS);

  for (const channel of channels) {
    await subscribe(`${WS_BRIDGE_PREFIX}${channel}`, (data) => {
      try {
        getIO().to(channel).emit(channel, data);
      } catch {
        // IO not ready yet
      }
    });
  }
  logger.info('WebSocket Redis bridge started', { channels: channels.length });
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

export function emitTradingState(state: string): void {
  emit(WS_CHANNELS.TRADING_STATE, {
    state,
    timestamp: new Date().toISOString(),
  });
}
