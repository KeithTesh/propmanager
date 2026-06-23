/**
 * Redis client (Upstash)
 *
 * Used for:
 * - Cron job distributed locks (SIM-A2, SIM-U2: only one instance runs billing cron)
 * - STK push state cache (fast lookup before DB)
 * - SMS rate limiter — 10/sec Africa's Talking limit (SIM-K1)
 * - Notification deduplication (prevent double-send in retry scenarios)
 */

import Redis from 'ioredis';
import { logger } from '../lib/logger';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');

    _redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 5) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: false,
      family: 4, // some hosts resolve IPv6 first; force IPv4 to avoid ETIMEDOUT on IPv6-less networks
    });

    _redis.on('error', (err) => logger.error({ err }, 'Redis error'));
    _redis.on('connect', () => logger.info('Redis connected'));
    _redis.on('reconnecting', () => logger.warn('Redis reconnecting'));
  }
  return _redis;
}

// ─── DISTRIBUTED LOCK ────────────────────────────────────────────────────────

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes default

/**
 * Acquire a distributed lock.
 * Returns lock token if acquired, null if already held.
 *
 * Used by billing cron to prevent duplicate runs (SIM-A2, SIM-U2)
 */
export async function acquireLock(
  key: string,
  ttlMs: number = LOCK_TTL_MS
): Promise<string | null> {
  const token = `${Date.now()}-${Math.random()}`;
  const redis = getRedis();
  const result = await redis.set(
    `lock:${key}`,
    token,
    'PX', ttlMs,
    'NX'       // only set if Not eXists
  );
  return result === 'OK' ? token : null;
}

/**
 * Release a lock — only if we still own it (token matches).
 * Uses Lua script for atomic check-and-delete.
 */
export async function releaseLock(key: string, token: string): Promise<void> {
  const redis = getRedis();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, `lock:${key}`, token);
}

/**
 * Run fn with distributed lock. Automatically releases on completion or error.
 * Returns null if lock could not be acquired (another instance is running).
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = LOCK_TTL_MS
): Promise<T | null> {
  const token = await acquireLock(key, ttlMs);
  if (!token) {
    logger.info({ key }, 'Lock not acquired — another instance running');
    return null;
  }
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

// ─── SMS RATE LIMITER ────────────────────────────────────────────────────────

/**
 * Sliding window rate limiter for SMS sends.
 * Africa's Talking: max 10 SMS/second per account (SIM-K1)
 * Returns true if SMS can be sent, false if rate limited.
 */
export async function checkSmsRateLimit(windowMs = 1000, maxPerWindow = 10): Promise<boolean> {
  const redis = getRedis();
  const key = 'ratelimit:sms';
  const now = Date.now();
  const windowStart = now - windowMs;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, '-inf', windowStart);   // remove old entries
  pipeline.zadd(key, now, `${now}-${Math.random()}`);    // add current
  pipeline.zcard(key);                                    // count in window
  pipeline.pexpire(key, windowMs * 2);                   // auto-clean

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;
  return count <= maxPerWindow;
}

// ─── NOTIFICATION DEDUP ──────────────────────────────────────────────────────

/**
 * Mark a notification as in-flight to prevent double-send.
 * Key expires after 10 minutes — longer than any reasonable retry window.
 */
export async function markNotificationInFlight(notificationId: string): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(
    `notif:inflight:${notificationId}`,
    '1',
    'PX', 10 * 60 * 1000,
    'NX'
  );
  return result === 'OK';
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

export async function checkRedisHealth(): Promise<boolean> {
  try {
    await getRedis().ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
    logger.info('Redis connection closed');
  }
}
