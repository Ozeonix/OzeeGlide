import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/health', () => {
  it('returns 200 with status ok and no-store cache headers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const body = (await res.json()) as {
      status: string
      version: string
      started_at: string
      timestamp: string
    }
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
    expect(body.started_at).toBeDefined()
  })
})
