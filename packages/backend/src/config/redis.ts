import Redis from 'ioredis';
import logger from './logger.js';

function createRedisClient(url: string, name: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
    lazyConnect: false,
  });

  client.on('connect', () => logger.info(`Redis[${name}] connected`));
  client.on('ready', () => logger.info(`Redis[${name}] ready`));
  client.on('error', (err: Error) =>
    logger.error(`Redis[${name}] error`, { error: err.message }),
  );
  client.on('close', () => logger.warn(`Redis[${name}] connection closed`));
  client.on('reconnecting', () => logger.info(`Redis[${name}] reconnecting`));
  client.on('end', () => logger.warn(`Redis[${name}] connection ended`));

  return client;
}

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = createRedisClient(redisUrl, 'main');

export { createRedisClient };
export default redis;
