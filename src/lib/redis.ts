import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';

if (!redisUrl || !redisToken) {
  console.warn('Warning: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set.');
}

// Initialize Upstash Redis
export const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

// Helper to create a rate limiter with a dynamic sliding window
export function getRateLimiter(limit: number, windowSeconds: number = 60) {
  return new Ratelimit({
    redis: redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: true,
    prefix: 'api-shield:ratelimit',
  });
}

/**
 * Checks rate limits dynamically for a specific tenant.
 * @param tenantId UUID of the tenant
 * @param rpm Requests per minute limit
 * @returns Rate limit check result
 */
export async function checkRateLimit(tenantId: string, rpm: number) {
  if (!redisUrl || !redisToken) {
    // If Redis is not configured, fail-open to avoid breaking API proxy in dev,
    // but log a warning.
    console.warn('Upstash Redis not configured. Rate limiting bypassed (fail-open).');
    return {
      success: true,
      limit: rpm,
      remaining: rpm,
      reset: Date.now() + 60000,
    };
  }

  const limiter = getRateLimiter(rpm, 60);
  const result = await limiter.limit(tenantId);

  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}
