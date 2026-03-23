/**
 * WebSocket test server helper.
 *
 * Creates a real HTTP + Socket.IO server bound to a random port for E2E tests.
 * Connects directly to the real database and Redis.
 */
import http from 'http';
import express from 'express';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { initWebSocket, getIO } from '../../../src/websocket/server.js';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import routes from '../../../src/routes/index.js';

// ─── Server setup ─────────────────────────────────────────────────────────────

export interface WsTestServer {
  url:        string;
  httpServer: http.Server;
  cleanup:    () => Promise<void>;
}

export async function startWsTestServer(): Promise<WsTestServer> {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  initWebSocket(httpServer);

  return new Promise((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address() as { port: number };
      const url  = `http://127.0.0.1:${addr.port}`;

      resolve({
        url,
        httpServer,
        async cleanup() {
          // Disconnect all Socket.IO clients
          try { getIO().close(); } catch { /* already closed */ }
          await new Promise<void>((res) => httpServer.close(() => res()));
        },
      });
    });
    httpServer.once('error', reject);
  });
}

// ─── Client factory ───────────────────────────────────────────────────────────

export interface WsTestClient {
  socket:    ClientSocket;
  disconnect: () => void;
}

/**
 * Create a Socket.IO client connected to the test server.
 * Optionally authenticated with a JWT.
 */
export function connectClient(
  serverUrl: string,
  options: { auth?: boolean; role?: 'admin' | 'viewer' } = {},
): WsTestClient {
  const { auth = false, role = 'admin' } = options;

  const authOpts = auth
    ? { auth: { token: makeTestJwt(role) } }
    : {};

  const socket = ioClient(serverUrl, {
    transports:      ['websocket'],
    reconnection:    true,
    reconnectionDelay: 100,
    reconnectionAttempts: 5,
    timeout:         5_000,
    ...authOpts,
  });

  return { socket, disconnect: () => socket.disconnect() };
}

/**
 * Wait for a Socket.IO event with a timeout.
 * Resolves with the payload or rejects on timeout.
 */
export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event:  string,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data: T) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }

    socket.on(event, handler);
  });
}

/**
 * Wait for a client socket to be connected.
 */
export function waitForConnect(socket: ClientSocket, timeoutMs = 3_000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Subscribe a client to a list of channels and wait for acknowledgement.
 */
export function subscribeToChannels(socket: ClientSocket, channels: string[]): void {
  socket.emit('subscribe', channels);
}

// ─── JWT helper ───────────────────────────────────────────────────────────────

export function makeTestJwt(role: 'admin' | 'viewer' = 'admin'): string {
  const secret = process.env.JWT_SECRET ?? 'test-jwt-secret';
  return jwt.sign({ sub: 'test-user', role }, secret, { expiresIn: '1h' });
}
