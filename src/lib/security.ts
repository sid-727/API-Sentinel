import crypto from 'crypto';
import { z } from 'zod';

/**
 * Hashes an API key using SHA-256.
 * @param apiKey Raw API key header value
 * @returns Hex-encoded SHA-256 digest
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Standard Security Headers to prevent common vulnerabilities
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:;",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-XSS-Protection': '1; mode=block',
};

/**
 * Zod Schema for the Secure API Proxy requests.
 * Standardized across supported LLM providers.
 */
export const ProxyRequestSchema = z.object({
  targetUrl: z.string().url().describe('The destination API URL (e.g. OpenAI completion endpoint)'),
  model: z.string().min(1).describe('Model identifier'),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
      content: z.string(),
    })
  ).min(1).describe('Chat history messages list'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
});

export type ProxyRequest = z.infer<typeof ProxyRequestSchema>;

/**
 * Applies security headers to an existing Response object or headers map.
 */
export function applySecurityHeaders(headers: Headers) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
}
