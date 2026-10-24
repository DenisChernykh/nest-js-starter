import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const baseline = '608410abc2885010a266075eb4b0107d1fc69417'
const canonicalComposePrefix =
  'production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --env-file /opt/nest-js-starter/active-api.env --file /opt/nest-js-starter/docker-compose.production.yml --file /opt/nest-js-starter/docker-compose.production.rollback.yml)'
const productionRunbooks = [
  'docs/runbooks/deployment.md',
  'docs/runbooks/deployment-preparation.md',
  'docs/runbooks/deployment-security.md',
  'docs/runbooks/rollback.md',
  'docs/runbooks/deployment-database-roles.md',
  'docs/runbooks/failed-prisma-migration.md',
]

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
    const selfService = read('docs/runbooks/self-service-account-lifecycle.md')

    for (const runbook of productionRunbooks) {
      const content = read(runbook)
      expect(content).toContain(canonicalComposePrefix)
      const bareComposeLines = content
        .split('\n')
        .filter((line) => /\bdocker compose\b/.test(line))
        .filter((line) => !line.includes(canonicalComposePrefix))
      expect(bareComposeLines).toEqual([])
    }

    for (const command of [
      '"${production_compose[@]}" config --quiet',
      '"${production_compose[@]}" up --detach --wait postgres redis-auth',
      '"${production_compose[@]}" exec -T postgres',
      'prepare-roles.sql',
      '"${production_compose[@]}" up --detach migrator',
      'timeout --foreground --signal=TERM --kill-after=30s 300s "${production_compose[@]}" wait migrator',
      '"${production_compose[@]}" ps --all migrator',
      'finalize-roles.sql',
      '"${production_compose[@]}" up --detach --wait api',
      '"${production_compose[@]}" logs --tail=200',
    ]) {
      expect(deployment).toContain(command)
    }
    expect(deployment).toContain('reverse_proxy {$CADDY_UPSTREAM_ALIAS}:3000')
    expect(deployment).not.toContain(
      'reverse_proxy ${CADDY_UPSTREAM_ALIAS}:3000',
    )
    expect(deployment).toContain('automatic HTTPS')
    expect(deployment).toContain('restart unless-stopped')
    for (const phrase of [
      'CADDY_UPSTREAM_ALIAS is copied into the host Caddy process environment',
      'Caddy does not automatically load /opt/nest-js-starter/.env',
      'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
      'systemctl reload caddy',
      'docker network inspect "$CADDY_NETWORK"',
      'docker inspect "$CADDY_CONTAINER"',
      'curl --fail-with-body --silent --show-error --max-time 10',
      'HTTP 200 and a JSON health body',
      'HTTP 401 or 403 and a problem body containing requestId',
    ]) {
      expect(deployment).toContain(phrase)
    }

    for (const phrase of [
      'production.env.example',
      'chmod 600 /opt/nest-js-starter/.env',
      'stat -c',
      'CADDY_NETWORK',
      'OBSERVABILITY_NETWORK',
      'docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin',
      'docker pull "$APP_IMAGE"',
      'config/deployment/production-preflight.sh',
      'org.opencontainers.image.revision',
      'RepoDigests',
      'DOCKER_CONFIG',
      'SERVICE_REVISION',
      'byte-for-byte',
      'trusted same-repository pull request',
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
      'unpadded base64url',
      'exactly 32 random bytes',
      'atomic',
      'per-secret recreation',
      'never place them in image, Git, shell history, logs',
    ]) {
      expect(security).toContain(phrase)
    }

    for (const phrase of [
      'schema compatibility',
      'no down-migration',
      'previous non-secret image/revision',
      'docker-compose.production.rollback.yml',
      'ACTIVE_API_IMAGE',
      'ACTIVE_API_REVISION',
      'active-api.env',
      'does not edit /opt/nest-js-starter/.env',
      '"${production_compose[@]}" up --detach --no-deps --wait api',
      'does not invoke the migrator',
      'SERVICE_REVISION',
    ]) {
      expect(rollback).toContain(phrase)
    }

    for (const phrase of [
      'requestId',
      'traceId',
      '{compose_service="api"} | json | requestId =',
      'curl -fsS --max-time 10 "$TEMPO_URL/api/v2/traces/$trace_id"',
      '"${production_compose[@]}" restart',
      'volume/network/readiness verification',
      'unperformed repository procedure',
    ]) {
      expect(deployment).toContain(phrase)
    }

    for (const phrase of [
      'production-preflight.sh',
      'MIGRATION_DATABASE_URL',
      'RUNTIME_DATABASE_URL',
      'forward-only',
      '"${production_compose[@]}" exec -T postgres',
    ]) {
      expect(read('docs/runbooks/deployment-database-roles.md')).toContain(
        phrase,
      )
      expect(read('docs/runbooks/failed-prisma-migration.md')).toContain(phrase)
    }

    for (const phrase of [
      'AUTH_SELF_SERVICE_MODE=open',
      'AUTH_PUBLIC_APP_URL',
      'AUTH_SMTP_URL',
      'AUTH_MAIL_FROM',
      'docker compose --profile mail up --detach --wait mail',
      'http://127.0.0.1:8025',
      'register',
      'capture verification',
      'old session rejected',
      'SMTP is not readiness',
      'partial audit',
      'never recover raw token from DB',
      'read fragment',
      'clear fragment from browser history',
    ]) {
      expect(selfService).toContain(phrase)
    }
    expect(read('docs/runbooks/deployment-database-roles.md')).not.toContain(
      'pnpm exec prisma migrate deploy',
    )
    expect(read('docs/runbooks/failed-prisma-migration.md')).not.toContain(
      'pnpm exec prisma migrate deploy',
    )
    const backupRestore = read('docs/runbooks/postgres-backup-restore.md')
    expect(backupRestore).toContain('isolated restore validation')
    expect(backupRestore).not.toContain('production promotion path')
    expect(backupRestore).toContain('POSTGRES_ADMIN_USER')

    for (const phrase of [
      'set -a',
      'set +a',
      'unset GHCR_READ_TOKEN GHCR_USERNAME',
      'cat /proc/sys/kernel/random/uuid',
      'startup_status',
      'ready_status',
      'auth_status="$(curl --silent --show-error --max-time 10',
      'loki_response="$(mktemp)"',
      'tempo_response="$(mktemp)"',
      'dist/bootstrap/admin/main.js',
      'stop --timeout 30 migrator',
    ]) {
      expect(deployment).toContain(phrase)
    }
    expect(deployment).not.toContain('request_id="production-drill-')

    for (const phrase of [
      'aws s3 cp',
      'shasum -a 256 --check',
      'prepare-roles.sql',
      'finalize-roles.sql',
      'cleanup_backup_workdir',
      'cleanup_restore_workdir',
    ]) {
      expect(backupRestore).toContain(phrase)
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
      'docs/runbooks/deployment.md',
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
