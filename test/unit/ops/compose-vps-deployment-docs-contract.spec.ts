import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const baseline = '608410abc2885010a266075eb4b0107d1fc69417'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function trackedSearch(term: string): {
  readonly output: string
  readonly status: number | null
} {
  const result = spawnSync('git', ['grep', '-n', '-I', '-i', '--', term], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return { output: `${result.stdout}${result.stderr}`, status: result.status }
}

describe('Compose VPS deployment documentation contract', () => {
  it('removes the executable operator and obsolete deployment paths', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string | undefined>
    }
    const obsoleteScripts = [
      ['deployment', 'preflight'].join(':'),
      ['deployment', 'promote'].join(':'),
      ['deployment', 'rollback'].join(':'),
    ]
    for (const script of obsoleteScripts) {
      expect(packageJson.scripts[script]).toBeUndefined()
    }

    const obsoletePaths = [
      'scripts/deployment',
      'test/unit/scripts/deployment',
      ['docs', 'runbooks', 'dok', 'ploy-deployment.md'].join('/'),
      [
        'docs',
        'runbooks',
        'backend-codex-deployment-operator-adoption.md',
      ].join('/'),
      ['docs', 'runbooks', 'release', '-manifest.example.json'].join('/'),
      [
        'docs',
        'superpowers',
        'plans',
        '2026-07-30-deployment-operator-cli.md',
      ].join('/'),
      [
        'docs',
        'superpowers',
        'plans',
        '2026-07-30-deployment-preparation.md',
      ].join('/'),
      [
        'docs',
        'superpowers',
        'specs',
        '2026-07-30-deployment-operator-cli-design.md',
      ].join('/'),
      [
        'docs',
        'superpowers',
        'specs',
        '2026-07-30-deployment-preparation-design.md',
      ].join('/'),
    ]
    for (const path of obsoletePaths) expect(existsSync(path)).toBe(false)
  })

  it('documents one explicit Compose and Caddy operator path', () => {
    const deployment = read('docs/runbooks/deployment.md')
    const preparation = read('docs/runbooks/deployment-preparation.md')
    const security = read('docs/runbooks/deployment-security.md')
    const rollback = read('docs/runbooks/rollback.md')
    const publication = read('docs/runbooks/stage-image-publication.md')

    for (const command of [
      'docker compose --env-file /opt/nest-js-starter/.env --file docker-compose.production.yml',
      'docker compose up --detach --wait postgres redis-auth',
      'docker compose exec -T postgres',
      'prepare-roles.sql',
      'docker compose up --detach migrator',
      'docker compose wait migrator',
      'docker compose ps --all migrator',
      'finalize-roles.sql',
      'docker compose up --detach --wait api',
      'docker compose logs --tail=200',
    ]) {
      expect(deployment).toContain(command)
    }
    expect(deployment).toContain('reverse_proxy ${CADDY_UPSTREAM_ALIAS}:3000')
    expect(deployment).toContain('automatic HTTPS')
    expect(deployment).toContain('restart unless-stopped')

    for (const phrase of [
      'production.env.example',
      'chmod 600 /opt/nest-js-starter/.env',
      'stat -c',
      'CADDY_NETWORK',
      'OBSERVABILITY_NETWORK',
      'docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin',
      'docker pull "$APP_IMAGE"',
      'org.opencontainers.image.revision',
      'SERVICE_REVISION',
      'byte-for-byte',
    ]) {
      expect(preparation).toContain(phrase)
    }

    for (const phrase of [
      'server-side .env',
      '0600',
      'POSTGRES_ADMIN_PASSWORD',
      'POSTGRES_MIGRATOR_PASSWORD',
      'POSTGRES_RUNTIME_PASSWORD',
      'CADDY_NETWORK',
      'OBSERVABILITY_NETWORK',
      'noeviction',
      'never place them in image, Git, shell history, logs',
    ]) {
      expect(security).toContain(phrase)
    }

    for (const phrase of [
      'schema compatibility',
      'no down-migration',
      'previous non-secret image/revision',
      'docker compose up --detach --no-deps --wait api',
      'does not invoke the migrator',
      'SERVICE_REVISION',
    ]) {
      expect(rollback).toContain(phrase)
    }

    for (const phrase of [
      'full stage gate',
      'immutable GHCR digest',
      'Trivy',
      'pull the same digest',
      'OCI smoke',
      'stage-image.yml',
    ]) {
      expect(publication).toContain(phrase)
    }
  })

  it('keeps the Stage publication workflow byte-identical to the baseline', () => {
    const current = read('.github/workflows/stage-image.yml')
    const baselineResult = spawnSync(
      'git',
      ['show', `${baseline}:.github/workflows/stage-image.yml`],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(baselineResult.status).toBe(0)
    expect(current).toBe(baselineResult.stdout)
  })

  it('has no tracked historical operator references', () => {
    const obsoleteTerms = [
      ['dok', 'ploy'].join(''),
      ['DOK', 'PLOY_'].join(''),
      ['release', '-manifest'].join(''),
      ['deployment', 'preflight'].join(':'),
      ['deployment', 'promote'].join(':'),
      ['deployment', 'rollback'].join(':'),
      ['promotion', '-evidence'].join(''),
    ]
    for (const term of obsoleteTerms) {
      const result = trackedSearch(term)
      expect(result.status).toBe(1)
      expect(result.output).toBe('')
    }
  })

  it('points the repository guide and roadmap at the Compose+Caddy contract', () => {
    const readme = read('README.md')
    const roadmap = read('docs/roadmap.md')

    for (const text of [
      'docker-compose.production.yml',
      'production.env.example',
      'Compose',
      'Caddy',
      'No deployment is performed by local checks',
    ]) {
      expect(readme).toContain(text)
    }
    for (const text of [
      'Compose+Caddy',
      'docker-compose.production.yml',
      'manual role preparation',
      'hosted verification remains unperformed',
    ]) {
      expect(roadmap).toContain(text)
    }
  })
})
