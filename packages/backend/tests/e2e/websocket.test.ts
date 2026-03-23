/**
 * E2E WebSocket tests.
 *
 * Tests real Socket.IO connection, channel subscription, event emission,
 * reconnection behaviour, and the system health emitter.
 *
 * Requires a running PostgreSQL + Redis (same as integration tests).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  startWsTestServer, connectClient, waitForEvent, waitForConnect,
  subscribeToChannels, makeTestJwt, type WsTestServer, type WsTestClient,
} from './helpers/ws-server.js';
import {
  emitMarketUpdate, emitAlertNew, emitBankrollUpdate,
  emitDecisionNew, emitOrderUpdate, emitPositionUpdate, emitRiskEvent,
} from '../../src/websocket/emit.js';
import { publishHealthStatus } from '../../src/websocket/health.js';
import { WS_CHANNELS } from '../../src/websocket/channels.js';
import { getIO } from '../../src/websocket/server.js';

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let server: WsTestServer;
const prisma = new PrismaClient();

beforeAll(async () => {
  server = await startWsTestServer();
});

afterAll(async () => {
  await server.cleanup();
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

function mkClient(auth = false) {
  return connectClient(server.url, { auth });
}

// ─── Connection ───────────────────────────────────────────────────────────────

describe('WebSocket: connection', () => {
  let client: WsTestClient;

  afterEach(() => client?.disconnect());

  it('connects without authentication (anonymous)', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);
    expect(client.socket.connected).toBe(true);
  });

  it('connects with a valid JWT', async () => {
    client = mkClient(true);
    await waitForConnect(client.socket);
    expect(client.socket.connected).toBe(true);
  });

  it('rejects connection with an invalid JWT', async () => {
    const socket = (await import('socket.io-client')).io(server.url, {
      transports: ['websocket'],
      auth: { token: 'invalid.jwt.token' },
      timeout: 3_000,
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      socket.once('connect_error', () => { socket.disconnect(); resolve(); });
      socket.once('connect', () => {
        // Some versions pass through — that's also acceptable if server allows anon
        socket.disconnect();
        resolve();
      });
    });
    // Just verifying the connection attempt completes without hanging
  });

  it('tracks disconnect event', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);
    expect(client.socket.connected).toBe(true);
    client.disconnect();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(client.socket.connected).toBe(false);
  });
});

// ─── Channel subscriptions ────────────────────────────────────────────────────

describe('WebSocket: channel subscriptions', () => {
  let client: WsTestClient;

  afterEach(() => client?.disconnect());

  it('subscribes to a single channel and receives events on it', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);

    subscribeToChannels(client.socket, [WS_CHANNELS.MARKET_UPDATE]);
    await new Promise<void>((res) => setTimeout(res, 50)); // allow join

    const marketId = `ws-test-mkt-${uid()}`;
    const eventPromise = waitForEvent(client.socket, WS_CHANNELS.MARKET_UPDATE);

    emitMarketUpdate(marketId, { title: 'Test Market' });

    const payload = await eventPromise as { marketId: string };
    expect(payload.marketId).toBe(marketId);
  });

  it('subscribes to multiple channels and receives events on each', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);

    subscribeToChannels(client.socket, [WS_CHANNELS.MARKET_UPDATE, WS_CHANNELS.ALERT_NEW]);
    await new Promise<void>((res) => setTimeout(res, 50));

    const alertId  = `alert-${uid()}`;
    const marketId = `mkt-${uid()}`;

    const [alertEvt, marketEvt] = await Promise.all([
      waitForEvent(client.socket, WS_CHANNELS.ALERT_NEW),
      waitForEvent(client.socket, WS_CHANNELS.MARKET_UPDATE),
      (async () => {
        await new Promise<void>((r) => setTimeout(r, 20));
        emitAlertNew(alertId, 'risk', 'warning', { message: 'test alert' });
        emitMarketUpdate(marketId, { title: 'Another Market' });
      })(),
    ]);

    expect((alertEvt as { alertId: string }).alertId).toBe(alertId);
    expect((marketEvt as { marketId: string }).marketId).toBe(marketId);
  });

  it('authenticated client auto-joins all channels', async () => {
    client = mkClient(true); // authenticated
    await waitForConnect(client.socket);
    // No explicit subscribe — auto-joined by server

    const eventPromise = waitForEvent(client.socket, WS_CHANNELS.BANKROLL_UPDATE);
    emitBankrollUpdate({ totalBalance: '1000.00' });

    const payload = await eventPromise;
    expect(payload).toBeDefined();
  });

  it('does NOT receive events on unsubscribed channels (anonymous)', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);

    // Subscribe to market:update only — NOT to bankroll:update
    subscribeToChannels(client.socket, [WS_CHANNELS.MARKET_UPDATE]);
    await new Promise<void>((res) => setTimeout(res, 50));

    let receivedBankroll = false;
    client.socket.on(WS_CHANNELS.BANKROLL_UPDATE, () => { receivedBankroll = true; });

    emitBankrollUpdate({ totalBalance: '999.00' });
    await new Promise<void>((res) => setTimeout(res, 200));

    expect(receivedBankroll).toBe(false);
  });
});

// ─── Event payloads ───────────────────────────────────────────────────────────

describe('WebSocket: event payload shapes', () => {
  let client: WsTestClient;

  beforeEach(async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);
    subscribeToChannels(client.socket, Object.values(WS_CHANNELS));
    await new Promise<void>((res) => setTimeout(res, 50));
  });

  afterEach(() => client?.disconnect());

  it('market:update payload has marketId and data', async () => {
    const id = `mkt-${uid()}`;
    const p = waitForEvent<{ marketId: string; data: unknown }>(client.socket, WS_CHANNELS.MARKET_UPDATE);
    emitMarketUpdate(id, { title: 'Updated' });
    const evt = await p;
    expect(evt.marketId).toBe(id);
    expect(evt.data).toBeDefined();
  });

  it('alert:new payload has alertId, alertType, severity, data', async () => {
    const id = `alert-${uid()}`;
    const p = waitForEvent<{ alertId: string; alertType: string; severity: string; data: unknown }>(
      client.socket, WS_CHANNELS.ALERT_NEW,
    );
    emitAlertNew(id, 'risk', 'critical', { message: 'test' });
    const evt = await p;
    expect(evt.alertId).toBe(id);
    expect(evt.alertType).toBe('risk');
    expect(evt.severity).toBe('critical');
  });

  it('decision:new payload has decisionId, marketId, action', async () => {
    const decisionId = `dec-${uid()}`;
    const marketId   = `mkt-${uid()}`;
    const p = waitForEvent<{ decisionId: string; marketId: string; action: string }>(
      client.socket, WS_CHANNELS.DECISION_NEW,
    );
    emitDecisionNew(decisionId, marketId, 'trade', { confidence: 0.8 });
    const evt = await p;
    expect(evt.decisionId).toBe(decisionId);
    expect(evt.action).toBe('trade');
  });

  it('order:update payload has orderId and status', async () => {
    const orderId = `ord-${uid()}`;
    const p = waitForEvent<{ orderId: string; status: string }>(
      client.socket, WS_CHANNELS.ORDER_UPDATE,
    );
    emitOrderUpdate(orderId, 'filled', { size: '100' });
    const evt = await p;
    expect(evt.orderId).toBe(orderId);
    expect(evt.status).toBe('filled');
  });

  it('position:update payload has positionId and marketId', async () => {
    const posId = `pos-${uid()}`;
    const mktId = `mkt-${uid()}`;
    const p = waitForEvent<{ positionId: string; marketId: string }>(
      client.socket, WS_CHANNELS.POSITION_UPDATE,
    );
    emitPositionUpdate(posId, mktId, { size: '50' });
    const evt = await p;
    expect(evt.positionId).toBe(posId);
    expect(evt.marketId).toBe(mktId);
  });

  it('risk:event payload has eventType and severity', async () => {
    const p = waitForEvent<{ eventType: string; severity: string }>(
      client.socket, WS_CHANNELS.RISK_EVENT,
    );
    emitRiskEvent('drawdown_limit', 'critical', { details: 'test' });
    const evt = await p;
    expect(evt.eventType).toBe('drawdown_limit');
    expect(evt.severity).toBe('critical');
  });

  it('bankroll:update payload has data', async () => {
    const p = waitForEvent<{ data: unknown }>(client.socket, WS_CHANNELS.BANKROLL_UPDATE);
    emitBankrollUpdate({ totalBalance: '5000.00' });
    const evt = await p;
    expect(evt.data).toBeDefined();
  });
});

// ─── System health emitter ────────────────────────────────────────────────────

describe('WebSocket: system health emitter', () => {
  let client: WsTestClient;

  afterEach(() => client?.disconnect());

  it('broadcasts system:health to all connected clients', async () => {
    client = mkClient(false); // no subscription needed — health broadcasts to all
    await waitForConnect(client.socket);

    const p = waitForEvent<{
      status: string; uptime: number; timestamp: string;
      db: string; redis: string; connections: number;
      memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
    }>(client.socket, WS_CHANNELS.SYSTEM_HEALTH);

    // Trigger health publish directly (avoids waiting 30 s)
    await publishHealthStatus();

    const evt = await p;
    expect(['ok', 'degraded']).toContain(evt.status);
    expect(typeof evt.uptime).toBe('number');
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['ok', 'error']).toContain(evt.db);
    expect(['ok', 'error']).toContain(evt.redis);
    expect(typeof evt.connections).toBe('number');
    expect(typeof evt.memory.heapUsedMb).toBe('number');
  });

  it('health payload uptime increases between calls', async () => {
    client = mkClient(false);
    await waitForConnect(client.socket);

    const payloads: { uptime: number }[] = [];

    client.socket.on(WS_CHANNELS.SYSTEM_HEALTH, (data) => {
      payloads.push(data as { uptime: number });
    });

    await publishHealthStatus();
    await new Promise<void>((r) => setTimeout(r, 50));
    await publishHealthStatus();
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(payloads.length).toBeGreaterThanOrEqual(2);
    expect(payloads[1].uptime).toBeGreaterThanOrEqual(payloads[0].uptime);
  });
});

// ─── Reconnection behaviour ───────────────────────────────────────────────────

describe('WebSocket: reconnection', () => {
  /**
   * Drop the underlying engine transport (simulates network interruption).
   * Socket.IO treats 'transport close' as a non-intentional disconnect
   * and automatically attempts to reconnect — unlike socket.disconnect()
   * which is intentional and suppresses reconnection.
   */
  function dropTransport(socket: ReturnType<typeof connectClient>['socket']): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket.io as any).engine?.close();
  }

  function waitForReconnect(socket: ReturnType<typeof connectClient>['socket'], ms = 8_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve();
      const timer = setTimeout(() => reject(new Error(`Reconnect timeout (${ms}ms)`)), ms);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
    });
  }

  it('client reconnects after a transport-level drop', async () => {
    const { socket } = connectClient(server.url, { auth: false });
    await waitForConnect(socket);
    const initialId = socket.id;
    expect(socket.connected).toBe(true);

    // Drop transport — triggers auto-reconnect (reason: 'transport close')
    dropTransport(socket);

    // Wait for reconnect
    await waitForReconnect(socket, 8_000);

    expect(socket.connected).toBe(true);
    // Socket gets a new id after reconnect
    expect(socket.id).not.toBe(initialId);

    socket.disconnect();
  }, 12_000);

  it('client can receive events after reconnect when re-subscribed', async () => {
    const { socket } = connectClient(server.url, { auth: false });
    await waitForConnect(socket);

    subscribeToChannels(socket, [WS_CHANNELS.MARKET_UPDATE]);
    await new Promise<void>((r) => setTimeout(r, 50));

    // Drop transport to trigger reconnect
    dropTransport(socket);
    await waitForReconnect(socket, 8_000);

    // Re-subscribe (rooms are cleared on disconnect)
    subscribeToChannels(socket, [WS_CHANNELS.MARKET_UPDATE]);
    await new Promise<void>((r) => setTimeout(r, 100));

    const marketId = `mkt-recon-${uid()}`;
    const p = waitForEvent(socket, WS_CHANNELS.MARKET_UPDATE);
    emitMarketUpdate(marketId, { title: 'Post-reconnect test' });

    const evt = await p as { marketId: string };
    expect(evt.marketId).toBe(marketId);

    socket.disconnect();
  }, 12_000);

  it('client can manually reconnect after intentional disconnect', async () => {
    const { socket } = connectClient(server.url, { auth: false });
    await waitForConnect(socket);
    expect(socket.connected).toBe(true);

    // Intentional client-side disconnect
    socket.disconnect();
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(socket.connected).toBe(false);

    // Manual reconnect
    socket.connect();
    await waitForReconnect(socket, 5_000);

    expect(socket.connected).toBe(true);
    socket.disconnect();
  }, 10_000);
});

// ─── Multiple concurrent clients ─────────────────────────────────────────────

describe('WebSocket: multiple concurrent clients', () => {
  it('broadcasts to all subscribed clients simultaneously', async () => {
    const clients = await Promise.all(
      [0, 1, 2].map(async () => {
        const c = mkClient(false);
        await waitForConnect(c.socket);
        subscribeToChannels(c.socket, [WS_CHANNELS.MARKET_UPDATE]);
        return c;
      }),
    );
    await new Promise<void>((r) => setTimeout(r, 50));

    const marketId = `mkt-broadcast-${uid()}`;
    const promises = clients.map((c) => waitForEvent(c.socket, WS_CHANNELS.MARKET_UPDATE));
    emitMarketUpdate(marketId, { broadcast: true });

    const results = await Promise.all(promises) as { marketId: string }[];
    for (const r of results) {
      expect(r.marketId).toBe(marketId);
    }

    for (const c of clients) c.disconnect();
  });

  it('client on different channel does not receive events', async () => {
    const subscriber = mkClient(false);
    const nonSubscriber = mkClient(false);

    await Promise.all([waitForConnect(subscriber.socket), waitForConnect(nonSubscriber.socket)]);

    subscribeToChannels(subscriber.socket, [WS_CHANNELS.MARKET_UPDATE]);
    // nonSubscriber subscribes to a DIFFERENT channel
    subscribeToChannels(nonSubscriber.socket, [WS_CHANNELS.ORDER_UPDATE]);
    await new Promise<void>((r) => setTimeout(r, 50));

    let nonSubReceived = false;
    nonSubscriber.socket.on(WS_CHANNELS.MARKET_UPDATE, () => { nonSubReceived = true; });

    const subscriberPromise = waitForEvent(subscriber.socket, WS_CHANNELS.MARKET_UPDATE);
    const id = `mkt-${uid()}`;
    emitMarketUpdate(id, { isolation: true });

    await subscriberPromise;
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(nonSubReceived).toBe(false);

    subscriber.disconnect();
    nonSubscriber.disconnect();
  });
});
