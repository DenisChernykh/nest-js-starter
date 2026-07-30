import { readFile } from 'node:fs/promises'

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, ' ')
}

describe('deployment operator documentation contract', () => {
  it('exposes only the three bounded package entrypoints', async () => {
    const packageJson = JSON.parse(await read('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts).toMatchObject({
      'deployment:preflight': 'tsx scripts/deployment/cli.ts preflight',
      'deployment:promote': 'tsx scripts/deployment/cli.ts promote',
      'deployment:rollback': 'tsx scripts/deployment/cli.ts rollback',
    })
    expect(packageJson.scripts.deployment).toBeUndefined()
  })

  it('makes the manifest CLI the only copyable promotion path', async () => {
    const deployment = await read('docs/runbooks/deployment.md')

    expect(deployment).toContain('release-manifest.example.json')
    expect(deployment).toContain('pnpm deployment:preflight -- --manifest')
    expect(deployment).toContain('pnpm deployment:promote -- --manifest')
    expect(deployment).toContain('offline dry-run')
    expect(deployment).toContain('only live promotion')
    expect(deployment).not.toContain('docker pull')
    expect(deployment).not.toContain('curl ')
  })

  it('documents every live input without historical digest constants', async () => {
    const dokploy = await read('docs/runbooks/dokploy-deployment.md')
    const names = [
      'DOKPLOY_BASE_URL',
      'DOKPLOY_API_KEY',
      'DOKPLOY_APPLICATION_ID',
      'DOKPLOY_APPLICATION_ENV',
      'DOKPLOY_PREVIOUS_APPLICATION_ENV',
      'GHCR_REGISTRY_URL',
      'GHCR_USERNAME',
      'GHCR_PASSWORD',
      'MIGRATION_DATABASE_URL',
      'RUNTIME_DATABASE_URL',
    ]

    for (const name of names) expect(dokploy).toContain(name)
    expect(dokploy).not.toMatch(/sha256:[0-9a-f]{64}/u)
    expect(dokploy).not.toContain('dokploy_curl')
    expect(dokploy).toContain('read:packages')
    expect(dokploy).toContain('mock tests are not hosted evidence')
  })

  it('keeps rollback explicit and schema-safe', async () => {
    const rollback = await read('docs/runbooks/rollback.md')

    expect(rollback).toContain('pnpm deployment:rollback -- --manifest')
    expect(rollback).toContain('no down-migration')
    expect(rollback).toContain('no automatic rollback')
    expect(rollback).not.toMatch(/sha256:[0-9a-f]{64}/u)
    expect(rollback).not.toContain('docker pull')
  })

  it('separates repository readiness from environment readiness', async () => {
    const preparation = normalized(
      await read('docs/runbooks/deployment-preparation.md'),
    )

    expect(preparation).toContain(
      'Repository readiness does not prove environment readiness',
    )
    expect(preparation).toContain('CLI does not provision infrastructure')
    expect(preparation).toContain('release-manifest.example.json')
    expect(preparation).toContain('promotion-evidence.json')
  })

  it('limits backend-codex transfer to a later documentation-owned adoption', async () => {
    const adoption = normalized(
      await read('docs/runbooks/backend-codex-deployment-operator-adoption.md'),
    )

    expect(adoption).toContain('backend-codex')
    expect(adoption).toContain('`adopt`')
    expect(adoption).toContain('`reconcile`')
    expect(adoption).toContain('`reject`')
    expect(adoption).toContain('atomic identity replacement')
    expect(adoption).toContain('product-module preservation')
    expect(adoption).toContain('no execution in this slice')
  })

  it('keeps local observability outside production readiness', async () => {
    const preparation = await read('docs/runbooks/deployment-preparation.md')

    for (const component of ['Alloy', 'Loki', 'Tempo', 'Grafana']) {
      expect(preparation).toContain(component)
    }
    expect(preparation).toContain(
      'excluded from production deployment readiness',
    )
  })
})
