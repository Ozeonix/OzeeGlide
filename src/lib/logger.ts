/**
 * Structured logger — thin wrapper around pino.
 *
 * Why pino over console.*:
 *   - Emits newline-delimited JSON in production (parseable by Datadog,
 *     Loki, CloudWatch Logs, Sentry, etc.)
 *   - Pretty-prints in dev (pino-pretty transport)
 *   - ~5× faster than console.log on high-throughput paths (automation
 *     engine, webhook ingest) because serialisation is synchronous + lazy.
 *   - Structured fields (requestId, accountId, automationId …) make
 *     log queries instant instead of regex hell.
 *
 * Usage:
 *   import { log } from '@/lib/logger'
 *
 *   log.info({ accountId, automationId }, 'automation dispatched')
 *   log.error({ err, automationId }, 'automation execute failed')
 *   log.warn({ contactId }, 'contact not in account, refusing dispatch')
 *
 * Child loggers (bind a fixed field to every message in a request):
 *   const reqLog = log.child({ requestId: crypto.randomUUID() })
 *   reqLog.info('handling webhook')
 *
 * Log levels (controlled via LOG_LEVEL env var, default 'info'):
 *   trace | debug | info | warn | error | fatal
 *
 * Install pino before using:
 *   npm install pino
 *   npm install --save-dev pino-pretty
 */

import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',

  // Redact sensitive fields that should never appear in log aggregators.
  // Add any field that may carry PII or secrets.
  redact: {
    paths: [
      'token',
      'access_token',
      'refresh_token',
      'password',
      'encryption_key',
      'SUPABASE_SERVICE_ROLE_KEY',
      'META_APP_SECRET',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },

  // In development: pretty-print with colour + human-readable timestamps.
  // In production: raw JSON for log aggregators (no extra process spawn).
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  }),
})

/**
 * Create a child logger pre-bound with request-scoped fields.
 * Typically called once at the top of a route handler or engine call.
 *
 * @example
 * const rlog = requestLogger(req, { accountId })
 * rlog.info('webhook accepted')
 */
export function requestLogger(
  req: { method?: string; url?: string },
  extra?: Record<string, unknown>,
) {
  return log.child({
    method: req.method,
    url: req.url,
    requestId: crypto.randomUUID(),
    ...extra,
  })
}
