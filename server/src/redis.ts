import { createClient } from 'redis';

/**
 * The few things Junro asks of Redis. Keeping the surface this small means a test can stand in
 * for Redis with a tiny stub (one that throws, or is "not ready"), with no fake-Redis library.
 */
export interface RedisHandle {
  /** True while connected and ready for commands. */
  readonly isReady: boolean;
  get(key: string): Promise<string | null>;
  /** Stores a value that disappears by itself after `ttlSeconds`. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /**
   * Adds one to a counter and makes sure the counter expires `windowMs` after it was created,
   * in ONE atomic step (`MULTI`: `INCR` then `PEXPIRE ... NX`). Returns the new count.
   */
  incrementWindow(key: string, windowMs: number): Promise<number>;
}

export interface RedisConnection extends RedisHandle {
  close(): Promise<void>;
  /** Deletes everything in the selected database (tests only). */
  flush(): Promise<void>;
}

/**
 * Connects to Redis. Commands fail at once while disconnected (no offline queue), so a Redis
 * outage never makes requests pile up. The client reconnects by itself, waiting up to 5 s.
 */
export function createRedis(url: string): RedisConnection {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
  });
  // Without an error listener node-redis would crash the whole process on a connection error.
  client.on('error', (error: Error) => logOncePerMinute(`Redis: ${error.message}`));
  void client.connect().catch(() => undefined); // failures are reported by the error listener

  return {
    get isReady() {
      return client.isReady;
    },
    get: (key) => client.get(key),
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, { EX: ttlSeconds });
    },
    incrementWindow: async (key, windowMs) => {
      const [count] = await client.multi().incr(key).pExpire(key, windowMs, 'NX').exec();
      return Number(count);
    },
    close: async () => {
      if (client.isOpen) await client.quit();
    },
    flush: async () => {
      await client.flushDb();
    },
  };
}

let lastLogged = 0;
/** Logs at most once a minute, so a long outage is one line a minute, not one per request. */
export function logOncePerMinute(message: string, now: () => number = Date.now): void {
  const current = now();
  if (current - lastLogged < 60_000) return;
  lastLogged = current;
  console.warn(message);
}

/** How long a Redis call may take before we stop waiting and use the fallback. */
export const REDIS_TIMEOUT_MS = 150;

/**
 * Runs `use(redis)`, and falls back to `fallback()` when Redis is not configured, not connected,
 * too slow (150 ms) or fails. Redis is only ever a shortcut, so every caller has a way to get the
 * same answer without it.
 */
export async function tryRedis<T>(
  redis: RedisHandle | undefined,
  use: (redis: RedisHandle) => Promise<T>,
  fallback: () => T | Promise<T>,
  timeoutMs: number = REDIS_TIMEOUT_MS,
): Promise<T> {
  if (!redis || !redis.isReady) return fallback();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      use(redis),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis timed out')), timeoutMs);
      }),
    ]);
  } catch (error) {
    logOncePerMinute(
      `Redis call failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}
