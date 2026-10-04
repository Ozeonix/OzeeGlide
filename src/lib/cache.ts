/**
 * Generic Redis-backed cache helper.
 *
 * Uses Upstash Redis (serverless, pay-per-request, no always-on cost).
 * Falls back gracefully to calling `fn` directly when the Redis env vars
 * are not set — so local dev, CI, and a single-instance deploy without
 * Upstash all work without any code change at the call site.
 *
 * Install:
 *   npm install @upstash/redis
 *
 * Required env vars (set in .env.local and production):
 *   UPSTASH_REDIS_REST_URL=
 *   UPSTASH_REDIS_REST_TOKEN=
 *
 * Usage:
 *   import { withCache, invalidate } from '@/lib/cache'
 *
 *   // Read-through: return cached value or call fn() and cache result
 *   const config = await withCache(
 *     `account:${accountId}:whatsapp-config`,
 *     300,             // TTL in seconds
 *     () => fetchConfigFromDB(accountId),
 *   )
 *
 *   // Invalidate on mutation
 *   await invalidate(`account:${accountId}:whatsapp-config`)
 *
 * Key naming convention (enforced by callers, not here):
 *   account:{accountId}:<resource>
 *   account:{accountId}:<resource>:page:{n}
 *   global:<resource>
 */

import { Redis } from '@upstash/redis'

// Build the client once at module load. If the env vars are absent
// (local dev without Upstash), client is null and every call falls
// through to the live DB — correct behaviour, no crash.
let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

/**
 * Read-through cache.
 *
 * Returns the cached value if present, otherwise calls `fn()`, stores
 * the result under `key` with `ttlSeconds` TTL, and returns the fresh
 * value. If Redis is unavailable (no env vars, network error), always
 * falls through to `fn()` — never throws.
 *
 * @param key        Cache key (namespace with account/resource prefix)
 * @param ttlSeconds Time-to-live in seconds
 * @param fn         Async function that produces the value on cache miss
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getRedis()

  if (client) {
    try {
      const cached = await client.get<T>(key)
      if (cached !== null && cached !== undefined) {
        return cached
      }
    } catch {
      // Redis unavailable — fall through to live DB. We deliberately
      // swallow the error here: a Redis outage should degrade gracefully
      // (slower responses) rather than take down the app entirely.
    }
  }

  const fresh = await fn()

  if (client && fresh !== null && fresh !== undefined) {
    try {
      await client.setex(key, ttlSeconds, fresh)
    } catch {
      // Non-fatal: value is already returned to the caller.
    }
  }

  return fresh
}

/**
 * Delete one or more cache keys.
 *
 * Call this from mutation endpoints (POST / PATCH / DELETE) to ensure
 * the next read sees fresh data. Silent no-op when Redis is not configured.
 *
 * @example
 * await invalidate(`account:${accountId}:whatsapp-config`)
 */
export async function invalidate(...keys: string[]): Promise<void> {
  if (!keys.length) return
  const client = getRedis()
  if (!client) return
  try {
    await client.del(...keys)
  } catch {
    // Non-fatal.
  }
}

/**
 * Delete all cache keys matching a prefix pattern.
 *
 * Uses SCAN — safe on large key spaces (non-blocking, cursor-based).
 * Useful when invalidating all pages of a list after a mutation.
 *
 * @example
 * await invalidatePrefix(`account:${accountId}:contacts:`)
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    let cursor = 0
    do {
      const [nextCursor, keys] = await client.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      })
      cursor = Number(nextCursor)
      if (keys.length) {
        await client.del(...keys)
      }
    } while (cursor !== 0)
  } catch {
    // Non-fatal.
  }
}
