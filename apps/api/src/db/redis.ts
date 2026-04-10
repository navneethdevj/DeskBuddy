import { createClient } from 'redis';
import config from '@api/config';
import { logger } from '@api/utils/logger';

type RedisClient = ReturnType<typeof createClient>;

/** Minimal Redis interface used by services — avoids leaking the full generic Redis type. */
export interface RedisOps {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string | number,
    options?: { EX?: number },
  ): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

export type RedisGetter = () => Promise<RedisOps>;

let _client: RedisClient | null = null;

function _createAndConnect(): RedisClient {
  const client = createClient({ url: config.REDIS_URL });
  client.on('error', (err: unknown) => logger.error({ err }, 'Redis client error'));
  return client;
}

// §5.9 — Reconnect when the stored client is no longer ready (e.g. after a
// Redis restart).  We destroy the stale client before creating a new one so
// there is never more than one connection attempt in flight.
export const getRedis: RedisGetter = async (): Promise<RedisOps> => {
  if (_client && _client.isReady) {
    return _client as unknown as RedisOps;
  }

  if (_client) {
    try { await _client.quit(); } catch (err: unknown) {
      // 'already closed' errors are benign; log anything else for observability
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('closed') && !msg.includes('destroyed')) {
        logger.warn({ err }, 'Redis quit error during reconnect cleanup');
      }
    }
    _client = null;
  }

  _client = _createAndConnect();
  await _client.connect();
  logger.info('Redis connected');

  return _client as unknown as RedisOps;
};

export const closeRedis = async (): Promise<void> => {
  if (_client?.isOpen) {
    await _client.quit();
    _client = null;
  }
};
