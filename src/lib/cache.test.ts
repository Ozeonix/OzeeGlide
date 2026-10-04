import { describe, expect, it, vi, beforeEach } from 'vitest'
import { withCache, invalidate, invalidatePrefix } from './cache'

describe('cache helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to calling fn() when Redis env vars are missing', async () => {
    const fn = vi.fn().mockResolvedValue({ id: 123, status: 'active' })
    const result = await withCache('test:missing_env', 60, fn)

    expect(result).toEqual({ id: 123, status: 'active' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('executes fn() and returns fresh value', async () => {
    let counter = 0
    const fn = vi.fn(async () => {
      counter += 1
      return `val_${counter}`
    })

    const res = await withCache('test:counter', 60, fn)
    expect(res).toBe('val_1')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('invalidate handles call safely without throwing', async () => {
    await expect(invalidate('test:key1', 'test:key2')).resolves.toBeUndefined()
    await expect(invalidate()).resolves.toBeUndefined()
  })

  it('invalidatePrefix handles call safely without throwing', async () => {
    await expect(invalidatePrefix('test:prefix:')).resolves.toBeUndefined()
  })
})
