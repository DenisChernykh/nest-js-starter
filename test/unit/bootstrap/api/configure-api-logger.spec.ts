import { readFileSync } from 'node:fs'

describe('API Nest logger bootstrap', () => {
  it('buffers startup logs and installs the structured Nest adapter', () => {
    const source = readFileSync('src/bootstrap/api/configure-api.ts', 'utf8')

    expect(source).toContain('bufferLogs: true')
    expect(source).toMatch(/app\.useLogger\(app\.get\(NestLoggerAdapter\)\)/u)
  })
})
