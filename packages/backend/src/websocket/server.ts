import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { WS_CHANNELS } from './channels.js';
import type { JwtPayload } from '../middleware/auth.js';

let io: SocketIOServer | null = null;

/** Verify the JWT token sent during the Socket.IO handshake. */
function verifySocketToken(token: string): JwtPayload | null {
  try {
    const secret = process.env.JWT_SECRET ?? '';
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}

export function initWebSocket(httpServer: HttpServer): SocketIOServer {
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30_000,
    pingInterval: 25_000,
  });

  // ── JWT auth middleware ────────────────────────────────────────────────────
  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth as Record<string, unknown>).token as string | undefined ??
      (socket.handshake.headers.authorization as string | undefined)?.replace('Bearer ', '');

    if (!token) {
      // Allow unauthenticated connections for read-only channel subscriptions
      // Set user to null so downstream handlers know it's anonymous
      (socket as Socket & { user: JwtPayload | null }).user = null;
      return next();
    }

    const payload = verifySocketToken(token);
    if (!payload) {
      return next(new Error('Invalid or expired token'));
    }
    (socket as Socket & { user: JwtPayload | null }).user = payload;
    next();
  });

  // ── Default namespace ──────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const user = (socket as Socket & { user: JwtPayload | null }).user;
    logger.info('WebSocket client connected', {
      socketId: socket.id,
      authenticated: user !== null,
      role: user?.role,
    });

    // Join requested channel rooms
    socket.on('subscribe', (channels: string[]) => {
      for (const channel of channels) {
        void socket.join(channel);
        logger.debug('Client subscribed', { socketId: socket.id, channel });
      }
    });

    socket.on('unsubscribe', (channels: string[]) => {
      for (const channel of channels) {
        void socket.leave(channel);
      }
    });

    // Auto-join all channels for authenticated clients
    if (user !== null) {
      for (const channel of Object.values(WS_CHANNELS)) {
        void socket.join(channel);
      }
    }

    socket.on('disconnect', (reason) => {
      logger.info('WebSocket client disconnected', { socketId: socket.id, reason });
    });

    socket.on('error', (err: Error) => {
      logger.error('WebSocket socket error', { socketId: socket.id, error: err.message });
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('WebSocket server not initialized — call initWebSocket first');
  return io;
}

export function broadcastToRoom(room: string, event: string, data: unknown): void {
  getIO().to(room).emit(event, data);
}

export function broadcastToAll(event: string, data: unknown): void {
  getIO().emit(event, data);
}
