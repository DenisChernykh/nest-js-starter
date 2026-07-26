import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateOpenApiArtifact } from '@/bootstrap/contracts/generate-openapi'
import { PrismaDatabaseLifecycle } from '@/platform/database/prisma-database.lifecycle'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { parseOpenApiWriterArguments } from '@scripts/openapi/write-openapi'

function runOpenApiWriter(arguments_: readonly string[]): {
  readonly exitCode: number
  readonly output: string
} {
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const result = spawnSync(
    command,
    [
      'pnpm@11.15.1',
      'exec',
      'tsx',
      'scripts/openapi/write-openapi.ts',
      ...arguments_,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}

describe('offline OpenAPI generation', () => {
  it('builds the complete prefixed document without runtime side effects', async () => {
    const listen = jest.spyOn(Server.prototype, 'listen')
    const connectDatabase = jest.spyOn(
      PrismaDatabaseLifecycle.prototype,
      'connect',
    )
    const connectRedis = jest.spyOn(RedisLifecycle.prototype, 'connect')

    const artifact = await generateOpenApiArtifact()
    const document = JSON.parse(artifact) as {
      readonly paths: Readonly<Record<string, unknown>>
      readonly components?: {
        readonly securitySchemes?: Readonly<
          Record<string, { readonly name?: string }>
        >
      }
    }

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/health/live',
        '/health/startup',
        '/health/ready',
        '/v1/auth/login',
        '/v1/auth/sessions/{sessionId}',
      ]),
    )
    expect(document.paths).not.toHaveProperty('/v1/health/live')
    expect(listen).not.toHaveBeenCalled()
    expect(connectDatabase).not.toHaveBeenCalled()
    expect(connectRedis).not.toHaveBeenCalled()
    expect(document.components?.securitySchemes?.['sessionCookie']?.name).toBe(
      '__Host-session',
    )
  })

  it('writes byte-identical canonical files on repeated generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openapi-offline-'))
    const firstPath = join(directory, 'first.json')
    const secondPath = join(directory, 'second.json')

    try {
      expect(runOpenApiWriter(['--output', firstPath]).exitCode).toBe(0)
      expect(runOpenApiWriter(['--output', secondPath]).exitCode).toBe(0)
      const [first, second] = await Promise.all([
        readFile(firstPath),
        readFile(secondPath),
      ])

      expect(first.equals(second)).toBe(true)
      expect(first.toString('utf8').endsWith('\n')).toBe(true)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects a CLI invocation without an explicit output path', () => {
    expect(() => parseOpenApiWriterArguments([])).toThrow(
      'OpenAPI output path is required',
    )
    const result = runOpenApiWriter([])
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('OpenAPI output path is required')
  })
})
