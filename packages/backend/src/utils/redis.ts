import { redis as mainRedis, createRedisClient } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Publish a message to a Redis channel.
 */
export async function publish(channel: string, data: unknown): Promise<void> {
  const payload = JSON.stringify(data);
  await mainRedis.publish(channel, payload);
  logger.debug('Published to channel', { channel });
}

/**
 * Subscribe to a Redis channel. Creates a dedicated subscriber connection.
 * Returns a cleanup function to unsubscribe.
 */
export async function subscribe(
  channel: string,
  handler: (data: unknown) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const sub = createRedisClient(redisUrl, `sub:${channel}`);

  await sub.subscribe(channel);

  sub.on('message', (_ch: string, message: string) => {
    try {
      const data = JSON.parse(message) as unknown;
      void Promise.resolve(handler(data)).catch((err: Error) => {
        logger.error('Subscription handler error', { channel, error: err.message });
      });
    } catch {
      logger.error('Failed to parse Redis message', { channel, message });
    }
  });

  logger.debug('Subscribed to channel', { channel });

  return async () => {
    await sub.unsubscribe(channel);
    sub.disconnect();
    logger.debug('Unsubscribed from channel', { channel });
  };
}
