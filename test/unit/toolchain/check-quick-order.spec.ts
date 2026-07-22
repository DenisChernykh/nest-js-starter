import { readFileSync } from 'node:fs'

describe('check:quick fresh-checkout order', () => {
  it('generates the Prisma client before loading the OpenAPI application graph', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly scripts?: Readonly<Record<string, string>>
    }
    const command = manifest.scripts?.['check:quick'] ?? ''
    const prismaGenerate = command.indexOf('run prisma:generate')
    const openApiDrift = command.indexOf('run openapi:drift')

    expect(prismaGenerate).toBeGreaterThanOrEqual(0)
    expect(openApiDrift).toBeGreaterThan(prismaGenerate)
  })
})
