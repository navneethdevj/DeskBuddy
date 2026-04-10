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

export const getRedis: RedisGetter = async (): Promise<RedisOps> => {
  if (!_client) {
    _client = createClient({ url: config.REDIS_URL });
    _client.on('error', (err: unknown) => logger.error({ err }, 'Redis client error'));
    await _client.connect();
    logger.info('Redis connected');
  }
  return _client as unknown as RedisOps;
};

export const closeRedis = async (): Promise<void> => {
  if (_client?.isOpen) {
    await _client.quit();
    _client = null;
  }
};
