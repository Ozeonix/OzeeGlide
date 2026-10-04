import { describe, expect, it } from 'vitest'
import { log, requestLogger } from './logger'

describe('logger', () => {
  it('exports a valid pino logger instance', () => {
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.debug).toBe('function')
  })

  it('creates a child request logger with bound request fields', () => {
    const req = { method: 'POST', url: 'https://example.com/api/test' }
    const child = requestLogger(req, { accountId: 'acc_123' })

    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
    expect(typeof child.error).toBe('function')
  })
})
