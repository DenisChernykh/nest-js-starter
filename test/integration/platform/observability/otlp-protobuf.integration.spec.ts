import { spawn } from 'node:child_process'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'

interface OtlpRequest {
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

describe('OTLP HTTP protobuf wire format', () => {
  it('sends non-empty protobuf trace and metric requests', async () => {
    const requests: OtlpRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        requests.push({
          path: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks),
        })
        response.writeHead(200, { 'content-type': 'application/x-protobuf' })
        response.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Collector listener address unavailable')
    }
    const fixture = join(
      process.cwd(),
      'test/integration/platform/observability/fixtures/otlp-protobuf.fixture.ts',
    )

    try {
      const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEST_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString()
      })
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      expect({ exitCode, output }).toEqual({ exitCode: 0, output: '' })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        )
      })
    }

    expect(requests.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/v1/traces', '/v1/metrics']),
    )
    for (const request of requests) {
      expect(request.headers['content-type']).toBe('application/x-protobuf')
      expect(request.body.length).toBeGreaterThan(0)
      expect(() => {
        JSON.parse(request.body.toString('utf8'))
      }).toThrow()
    }
  })
})
