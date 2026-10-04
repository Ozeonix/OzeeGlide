import { NextResponse } from 'next/server'

/**
 * GET /api/health
 *
 * Unauthenticated liveness probe used by:
 *   - Docker / Kubernetes healthcheck
 *   - Uptime monitors (BetterUptime, Checkly, etc.)
 *   - Load balancer health checks
 *
 * Returns 200 while the Node process is up and the event loop
 * is responsive. Intentionally does NOT check Supabase — a DB
 * hiccup that lets the app serve cached/static content should
 * not pull the instance from the load-balancer pool. Use a
 * separate deep-health or readiness probe for DB connectivity.
 */
export const dynamic = 'force-dynamic'

const startedAt = new Date().toISOString()

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      version: process.env.npm_package_version ?? 'unknown',
      started_at: startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        // Never cache the health endpoint — monitors must see live status.
        'Cache-Control': 'no-store',
      },
    },
  )
}
