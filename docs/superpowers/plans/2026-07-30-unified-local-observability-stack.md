# Unified Local Observability Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать `pnpm dev` единым локальным workflow, который применяет
закоммиченные Prisma migrations, запускает watched Nest API, PostgreSQL, Redis,
Alloy, Loki, Tempo и Grafana и сохраняет коррелированные logs/traces без
зависимости API readiness от observability.

**Architecture:** Один non-root development image используется локальными
`api` и one-shot `migrator`; migrator ждёт только PostgreSQL, а API ждёт
успешный migrator и healthy Redis. Compose Watch синхронизирует исходники только
в API. Pino остаётся stdout-only, Alloy собирает Docker logs в Loki и принимает
trace-only OTLP/HTTP для Tempo, а Grafana предоставляет provisioned
двунаправленную корреляцию.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, NestJS 11, Prisma 7.9.0,
Docker Compose Watch, Grafana Alloy v1.18.0, Loki 3.7.2, Tempo 2.10.7,
Grafana 13.1.0, OpenTelemetry OTLP/HTTP protobuf, Pino JSON, Jest 30.

## Global Constraints

- Канонический дизайн:
  `docs/superpowers/specs/2026-07-30-unified-local-observability-stack-design.md`.
- Работать только в `nest-js-starter`; `backend-codex` является read-only
  reference и не изменяется.
- Не добавлять product workers, uploads, product schema или queue Redis.
- Production и deployment полностью находятся за рамками этого плана и будут
  отдельной задачей после локального logs/traces workflow. Существующие
  связанные файлы разрешено только проверить на отсутствие случайных изменений.
- Не добавлять Alloy, Loki, Tempo или Grafana clients в application TypeScript.
- Pino остаётся stdout-only; OpenTelemetry остаётся trace-only.
- API никогда не применяет migrations самостоятельно.
- Local migrator зависит только от healthy PostgreSQL; API отдельно зависит от
  successful migrator и healthy Redis.
- Alloy, Loki, Tempo и Grafana не входят в API `depends_on` и не влияют на
  `/health/live` или `/health/ready`.
- Все host ports публикуются только на `127.0.0.1`.
- Loki, Tempo и Grafana используют отдельные named volumes с retention `168h`.
- Docker socket монтируется read-only только в local Alloy текущего Compose
  project.
- `requestId`, `traceId`, `spanId`, event, module, reason code и user identity
  не становятся Loki labels.
- Использовать exact image version + digest из Fixed Image Contract; не
  заменять их на `latest`.
- Не добавлять package dependencies или изменять `pnpm-lock.yaml`.
- Каждый hand-written exported TypeScript contract получает TSDoc; план не
  добавляет exported runtime TypeScript contracts.
- Соблюдать RED → GREEN: каждый config/runtime contract сначала фиксируется
  узким Jest test, затем реализуется и повторно проверяется.
- После implementation выполнить `pnpm check:quick`; не заявлять PASS по
  старому или частичному выводу.
- Runtime smoke использует только project
  `nest-js-starter-observability-smoke`, выделенные host ports и собственные
  volumes; другие Docker projects и volumes не изменяются.
- Не выполнять push, PR или merge в рамках плана.

## Fixed Image Contract

```yaml
alloy: grafana/alloy:v1.18.0@sha256:491b0578c04983fd54fe99b587b6fab4404dc46d0dc16677bd6b00cc1140b308
grafana: grafana/grafana:13.1.0@sha256:121a7a9ece6dc10b969f1f96eed64b4f07dfac0d0b8abc070f7cb83bbde86f63
loki: grafana/loki:3.7.2@sha256:191d4fdfb7264f16989f0a57f320872620a5a7c2ceeec6229212c4190ec49b86
tempo: grafana/tempo:2.10.7@sha256:032b3acb51ed02c4b801473d54bb63e9e9f13738d215126d9843c30283794f4b
```

Перед изменениями проверить, что Docker может pull exact digest. Ошибка pull
останавливает implementation как registry/environment boundary; version или
digest не заменяются догадкой.

## File Map

### Create

- `config/observability/alloy/config.alloy` — Docker log discovery/parsing и
  trace-only OTLP routing.
- `config/observability/loki/loki.yaml` — local filesystem storage и 7-day log
  retention.
- `config/observability/tempo/tempo.yaml` — local trace storage и 7-day trace
  retention.
- `config/observability/grafana/provisioning/datasources/observability.yaml` —
  provisioned Loki/Tempo correlation.
- `test/unit/ops/local-compose-runtime-contract.spec.ts` — resolved Compose,
  image, dependency, Watch, port, volume и command contracts.
- `docs/runbooks/local-development.md` — canonical local workflow, restart
  matrix, failures и data lifecycle.

### Modify

- `Dockerfile` — non-root `development` target; существующий `runtime` stage
  остаётся без изменений.
- `docker-compose.yml` — local API, migrator, observability services, Watch и
  volumes.
- `package.json` — `dev`, `dev:api`, `dev:host`, `dev:down`.
- `.env.example` — `OTLP_HTTP_PORT` и `GRAFANA_PORT`.
- `test/unit/toolchain/standard-nest-development-start.spec.ts` — public versus
  internal development commands and development target contract.
- `README.md` — concise happy path and runbook link.
- `docs/architecture/errors-logging-observability.md` — signal and availability
  boundaries.
- `docs/runbooks/telemetry-collector-loss.md` — local Alloy outage/recovery.

---

### Task 1: Add the internal Nest watcher and reusable development image

**Files:**

- Modify: `test/unit/toolchain/standard-nest-development-start.spec.ts`
- Modify: `package.json`
- Modify: `Dockerfile`

**Interfaces:**

- Consumes: existing Nest CLI entrypoint `bootstrap/api/main` and pinned
  `dependencies` Docker stage.
- Produces: Docker target `development`; script `dev:api`; public scripts
  `dev`, `dev:host`, `dev:down` consumed by later Compose and docs tasks.

- [ ] **Step 1: Replace the outdated command assertions with failing public/internal command tests**

Add `dockerfileSource` and require the following exact behavior:

```ts
it('keeps dev:api as the internal Nest CLI watcher', () => {
  const scripts = readPackageManifest().scripts ?? {}

  expect(scripts['dev:api']).toBe(
    'corepack pnpm@11.15.1 run prisma:generate && nest start --watch --no-shell',
  )
  expect(scripts['dev:api']).not.toContain('tsx watch')
  expect(scripts['dev:api']).not.toContain('docker')
})

it('makes dev the canonical observable Compose Watch command', () => {
  const scripts = readPackageManifest().scripts ?? {}

  expect(scripts.dev).toBe(
    'docker compose --profile development --profile observability up --watch api alloy loki tempo grafana',
  )
  expect(scripts['dev:host']).toBe(
    'OTEL_SDK_DISABLED=true corepack pnpm@11.15.1 run dev:api',
  )
  expect(scripts['dev:down']).toBe(
    'docker compose --profile development --profile observability stop api migrator alloy loki tempo grafana postgres redis-coordination',
  )
  expect(scripts['dev:down']).not.toMatch(/\bdown\b|--volumes|docker volume/u)
})

it('defines a writable non-root development image target', () => {
  const dockerfileSource = readFileSync(
    join(process.cwd(), 'Dockerfile'),
    'utf8',
  )

  expect(dockerfileSource).toContain('FROM dependencies AS development')
  expect(dockerfileSource).toContain('mkdir -p /app/dist')
  expect(dockerfileSource).toMatch(
    /FROM dependencies AS development[\s\S]*USER node[\s\S]*CMD \["corepack", "pnpm@11\.15\.1", "run", "dev:api"\]/u,
  )
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs \
  --runInBand \
  test/unit/toolchain/standard-nest-development-start.spec.ts
```

Expected: FAIL because `dev` still runs Nest directly, `dev:host`/`dev:down`
are absent and `Dockerfile` has no `development` target.

- [ ] **Step 3: Implement the minimal package command contract**

Set only these scripts:

```json
{
  "dev": "docker compose --profile development --profile observability up --watch api alloy loki tempo grafana",
  "dev:api": "corepack pnpm@11.15.1 run prisma:generate && nest start --watch --no-shell",
  "dev:down": "docker compose --profile development --profile observability stop api migrator alloy loki tempo grafana postgres redis-coordination",
  "dev:host": "OTEL_SDK_DISABLED=true corepack pnpm@11.15.1 run dev:api"
}
```

Do not modify dependencies or lockfile.

- [ ] **Step 4: Add the development Docker target**

Insert after `dependencies` and before `build`:

```dockerfile
FROM dependencies AS development
ENV NODE_ENV=development \
    API_HOST=0.0.0.0 \
    pnpm_config_verify_deps_before_run=false
COPY --chown=node:node . .
RUN mkdir -p /app/dist && chown -R node:node /app/dist
USER node
EXPOSE 3000
CMD ["corepack", "pnpm@11.15.1", "run", "dev:api"]
```

Do not change the existing `build` or `runtime` stages.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: PASS with all command, Nest CLI and Dockerfile assertions green.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json Dockerfile \
  test/unit/toolchain/standard-nest-development-start.spec.ts
git commit -m "feat(dev): add watched API development image"
```

---

### Task 2: Add fail-closed local migrator and watched API composition

**Files:**

- Create: `test/unit/ops/local-compose-runtime-contract.spec.ts`
- Modify: `docker-compose.yml`

**Interfaces:**

- Consumes: `development` image target and `dev:api` from Task 1.
- Produces: services `migrator` and `api`; resolved Compose helper reused by
  Task 3 observability assertions.

- [ ] **Step 1: Write the resolved Compose helper and failing migration/API contract**

Create the test with these local interfaces and helpers:

```ts
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

interface ResolvedComposeBuild {
  readonly context?: string
  readonly target?: string
}

interface ResolvedComposeDependency {
  readonly condition?: string
  readonly required?: boolean
}

interface ResolvedComposePort {
  readonly host_ip?: string
  readonly published?: string
  readonly target?: number
}

interface ResolvedComposeWatchRule {
  readonly action?: string
  readonly initial_sync?: boolean
  readonly path?: string
  readonly target?: string
}

interface ResolvedComposeVolume {
  readonly read_only?: boolean
  readonly source?: string
  readonly target?: string
  readonly type?: string
}

interface ResolvedComposeService {
  readonly build?: ResolvedComposeBuild
  readonly command?: unknown
  readonly depends_on?: Readonly<Record<string, ResolvedComposeDependency>>
  readonly develop?: {
    readonly watch?: readonly ResolvedComposeWatchRule[]
  }
  readonly environment?: Readonly<Record<string, string>>
  readonly image?: string
  readonly ports?: readonly ResolvedComposePort[]
  readonly profiles?: readonly string[]
  readonly restart?: string
  readonly volumes?: readonly ResolvedComposeVolume[]
}

interface ResolvedComposeConfiguration {
  readonly services: Readonly<Record<string, ResolvedComposeService>>
  readonly volumes?: Readonly<Record<string, unknown>>
}

function resolveLocalCompose(): ResolvedComposeConfiguration {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'nest-js-starter-contract',
      '--env-file',
      '.env.example',
      '--profile',
      'development',
      '--profile',
      'observability',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        API_PORT: '33000',
        GRAFANA_PORT: '33004',
        OTLP_HTTP_PORT: '34318',
        POSTGRES_PORT: '35432',
        REDIS_PORT: '36379',
      },
    },
  )

  if (result.status !== 0) {
    throw new Error(
      `Docker Compose config exited with ${String(result.status)}: ${result.stderr}`,
    )
  }

  return JSON.parse(result.stdout) as ResolvedComposeConfiguration
}

function requireService(
  configuration: ResolvedComposeConfiguration,
  serviceName: string,
): ResolvedComposeService {
  const service = configuration.services[serviceName]

  if (service === undefined) {
    throw new Error(`Missing required Compose service: ${serviceName}`)
  }

  return service
}
```

Add the first contract:

```ts
describe('local Compose runtime contract', () => {
  it('runs committed migrations before the watched API and keeps Redis separate', () => {
    const configuration = resolveLocalCompose()
    const migrator = requireService(configuration, 'migrator')
    const api = requireService(configuration, 'api')

    expect(migrator.image).toBe('nest-js-starter:development')
    expect(migrator.build).toEqual(
      expect.objectContaining({ target: 'development' }),
    )
    expect(migrator.command).toEqual([
      'corepack',
      'pnpm@11.15.1',
      'run',
      'start:migrate',
    ])
    expect(migrator.depends_on?.postgres?.condition).toBe('service_healthy')
    expect(Object.keys(migrator.depends_on ?? {})).toEqual(['postgres'])
    expect(migrator.environment).toEqual({
      DATABASE_URL:
        'postgresql://nest_js_starter:nest_js_starter@postgres:5432/nest_js_starter?schema=public',
    })
    expect(migrator.restart).toBe('no')

    expect(api.profiles).toContain('development')
    expect(api.image).toBe('nest-js-starter:development')
    expect(api.build).toEqual(migrator.build)
    expect(api.depends_on?.migrator?.condition).toBe(
      'service_completed_successfully',
    )
    expect(api.depends_on?.['redis-coordination']?.condition).toBe(
      'service_healthy',
    )
    expect(api.depends_on).not.toHaveProperty('alloy')
    expect(api.environment).toEqual(
      expect.objectContaining({
        API_HOST: '0.0.0.0',
        API_PORT: '3000',
        DATABASE_URL:
          'postgresql://nest_js_starter:nest_js_starter@postgres:5432/nest_js_starter?schema=public',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318',
        OTEL_SDK_DISABLED: 'false',
        REDIS_COORDINATION_URL:
          'redis://default:local-development-only@redis-coordination:6379',
      }),
    )
    expect(api.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 3000 }),
    ])

    const watch = api.develop?.watch ?? []

    expect(watch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'sync',
          initial_sync: true,
          target: '/app/src',
        }),
      ]),
    )

    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'prisma',
      'prisma.config.ts',
    ]) {
      expect(
        watch.some(
          (rule) =>
            rule.action === 'rebuild' &&
            rule.path?.endsWith(`/${path}`) === true,
        ),
      ).toBe(true)
    }

    for (const path of [
      'nest-cli.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'tsconfig.base.json',
    ]) {
      expect(
        watch.some(
          (rule) =>
            rule.action === 'sync+restart' &&
            rule.path?.endsWith(`/${path}`) === true,
        ),
      ).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs \
  --runInBand \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

Expected: FAIL with `Missing required Compose service: migrator`.

- [ ] **Step 3: Add reusable local image and API environment anchors**

Add before `services`:

```yaml
x-development-image: &development-image
  image: nest-js-starter:development
  build:
    context: .
    target: development

x-api-environment: &api-environment
  NODE_ENV: ${NODE_ENV:-development}
  LOG_LEVEL: ${LOG_LEVEL:-info}
  OTEL_SERVICE_NAME: ${OTEL_SERVICE_NAME:-nest-js-starter}
  SERVICE_VERSION: ${SERVICE_VERSION:-0.1.0-alpha.0}
  SERVICE_REVISION: ${SERVICE_REVISION:-local}
  OTEL_SDK_DISABLED: 'false'
  OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4318
  API_HOST: 0.0.0.0
  API_PORT: 3000
  API_DOCS_MODE: ${API_DOCS_MODE:-public}
  PUBLIC_API_URL: ${PUBLIC_API_URL}
  CORS_ORIGINS: ${CORS_ORIGINS}
  TRUST_PROXY_CIDRS: ${TRUST_PROXY_CIDRS}
  DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
  DATABASE_POOL_MAX: ${DATABASE_POOL_MAX:-10}
  REDIS_COORDINATION_URL: redis://default:local-development-only@redis-coordination:6379
  REDIS_KEY_PREFIX: ${REDIS_KEY_PREFIX:-nest-js-starter}
  AUTH_SESSION_KEY_SECRET: ${AUTH_SESSION_KEY_SECRET}
  AUTH_CSRF_SECRET: ${AUTH_CSRF_SECRET}
  AUTH_RATE_LIMIT_KEY_SECRET: ${AUTH_RATE_LIMIT_KEY_SECRET}
  AUTH_NETWORK_METADATA_SECRET: ${AUTH_NETWORK_METADATA_SECRET}
```

- [ ] **Step 4: Add migrator and watched API services**

Add after `redis-coordination`:

```yaml
migrator:
  <<: *development-image
  command: ['corepack', 'pnpm@11.15.1', 'run', 'start:migrate']
  environment:
    DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
  depends_on:
    postgres:
      condition: service_healthy
  restart: 'no'

api:
  <<: *development-image
  profiles:
    - development
  environment: *api-environment
  depends_on:
    migrator:
      condition: service_completed_successfully
    redis-coordination:
      condition: service_healthy
  ports:
    - '127.0.0.1:${API_PORT:-3000}:3000'
  develop:
    watch:
      - action: sync
        path: ./src
        target: /app/src
        initial_sync: true
      - action: rebuild
        path: ./package.json
      - action: rebuild
        path: ./pnpm-lock.yaml
      - action: rebuild
        path: ./pnpm-workspace.yaml
      - action: rebuild
        path: ./prisma
      - action: rebuild
        path: ./prisma.config.ts
      - action: sync+restart
        path: ./nest-cli.json
        target: /app/nest-cli.json
      - action: sync+restart
        path: ./tsconfig.json
        target: /app/tsconfig.json
      - action: sync+restart
        path: ./tsconfig.build.json
        target: /app/tsconfig.build.json
      - action: sync+restart
        path: ./tsconfig.base.json
        target: /app/tsconfig.base.json
```

Do not add Redis or observability to `migrator.depends_on`. Do not bind-mount
source or host `node_modules`.

- [ ] **Step 5: Run the Compose contract and inspect normalized shapes**

Run the Step 2 Jest command.

Expected: PASS. If only normalized `required` or resolved absolute `context`
shape differs, inspect one bounded `docker compose ... config --format json`
result, update the local interface/assertion to the actual stable Compose
model, and retain all semantic checks.

- [ ] **Step 6: Run the existing command contract**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs \
  --runInBand \
  test/unit/toolchain/standard-nest-development-start.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add docker-compose.yml test/unit/ops/local-compose-runtime-contract.spec.ts
git commit -m "feat(dev): gate local API on committed migrations"
```

---

### Task 3: Add Alloy, Loki, Tempo and Grafana configuration

**Files:**

- Create: `config/observability/alloy/config.alloy`
- Create: `config/observability/loki/loki.yaml`
- Create: `config/observability/tempo/tempo.yaml`
- Create:
  `config/observability/grafana/provisioning/datasources/observability.yaml`
- Modify: `test/unit/ops/local-compose-runtime-contract.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**

- Consumes: Compose project identity and API OTLP endpoint from Task 2.
- Produces: internal logs/traces pipeline, Grafana datasource UIDs `loki` and
  `tempo`, ports `OTLP_HTTP_PORT` and `GRAFANA_PORT`, named observability
  volumes.

- [ ] **Step 1: Extend the Compose test with failing observability assertions**

Add image constants:

```ts
const observabilityImages = Object.freeze({
  alloy:
    'grafana/alloy:v1.18.0@sha256:491b0578c04983fd54fe99b587b6fab4404dc46d0dc16677bd6b00cc1140b308',
  grafana:
    'grafana/grafana:13.1.0@sha256:121a7a9ece6dc10b969f1f96eed64b4f07dfac0d0b8abc070f7cb83bbde86f63',
  loki: 'grafana/loki:3.7.2@sha256:191d4fdfb7264f16989f0a57f320872620a5a7c2ceeec6229212c4190ec49b86',
  tempo:
    'grafana/tempo:2.10.7@sha256:032b3acb51ed02c4b801473d54bb63e9e9f13738d215126d9843c30283794f4b',
})
```

Add tests:

```ts
it('pins and isolates the local observability services', () => {
  const configuration = resolveLocalCompose()

  for (const [serviceName, image] of Object.entries(observabilityImages)) {
    const service = requireService(configuration, serviceName)

    expect(service.profiles).toContain('observability')
    expect(service.image).toBe(image)
  }

  const alloy = requireService(configuration, 'alloy')
  const grafana = requireService(configuration, 'grafana')
  const loki = requireService(configuration, 'loki')
  const tempo = requireService(configuration, 'tempo')

  expect(alloy.environment?.ALLOY_DOCKER_COMPOSE_PROJECT).toBe(
    'nest-js-starter-contract',
  )
  expect(alloy.ports).toEqual([
    expect.objectContaining({ host_ip: '127.0.0.1', target: 4318 }),
  ])
  expect(grafana.ports).toEqual([
    expect.objectContaining({ host_ip: '127.0.0.1', target: 3000 }),
  ])
  expect(loki.ports).toBeUndefined()
  expect(tempo.ports).toBeUndefined()
  for (const serviceName of [
    'postgres',
    'redis-coordination',
    'api',
    'alloy',
    'grafana',
  ]) {
    for (const port of requireService(configuration, serviceName).ports ?? []) {
      expect(port.host_ip).toBe('127.0.0.1')
    }
  }
  expect(alloy.volumes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        read_only: true,
        source: '/var/run/docker.sock',
        target: '/var/run/docker.sock',
        type: 'bind',
      }),
    ]),
  )
  expect(grafana.volumes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        read_only: true,
        target: '/etc/grafana/provisioning/datasources',
        type: 'bind',
      }),
      expect.objectContaining({
        source: 'grafana-data',
        target: '/var/lib/grafana',
        type: 'volume',
      }),
    ]),
  )
  expect(loki.volumes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'loki-data',
        target: '/loki',
        type: 'volume',
      }),
    ]),
  )
  expect(tempo.volumes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'tempo-data',
        target: '/var/tempo',
        type: 'volume',
      }),
    ]),
  )
  expect(configuration.volumes).toHaveProperty('grafana-data')
  expect(configuration.volumes).toHaveProperty('loki-data')
  expect(configuration.volumes).toHaveProperty('tempo-data')
})

it('preserves correlation literals and bounded low-cardinality storage', () => {
  const configurationPaths = [
    'config/observability/alloy/config.alloy',
    'config/observability/loki/loki.yaml',
    'config/observability/tempo/tempo.yaml',
    'config/observability/grafana/provisioning/datasources/observability.yaml',
  ]

  for (const path of configurationPaths) {
    expect(existsSync(path)).toBe(true)
  }

  if (configurationPaths.some((path) => !existsSync(path))) {
    return
  }

  const provisioning = readFileSync(
    'config/observability/grafana/provisioning/datasources/observability.yaml',
    'utf8',
  )
  const alloy = readFileSync('config/observability/alloy/config.alloy', 'utf8')
  const loki = readFileSync('config/observability/loki/loki.yaml', 'utf8')
  const tempo = readFileSync('config/observability/tempo/tempo.yaml', 'utf8')
  const labelsStage = /stage\.labels \{([\s\S]*?)\n  \}/u.exec(alloy)?.[1]

  expect(provisioning).toContain("'$${__value.raw}'")
  expect(provisioning).toContain('$${__resource.service.name}')
  expect(provisioning).toContain('$${__span.traceId}')
  expect(labelsStage).toContain('environment = ""')
  expect(labelsStage).toContain('level       = ""')
  expect(labelsStage).toContain('service     = ""')
  expect(labelsStage).not.toMatch(
    /requestId|traceId|spanId|event|module|reasonCode/u,
  )
  expect(loki).toMatch(/retention_period:\s+168h/u)
  expect(tempo).toMatch(/block_retention:\s+168h/u)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 2 Step 2 Jest command.

Expected: FAIL with `Missing required Compose service: alloy`.

- [ ] **Step 3: Create the Alloy configuration**

Create:

```alloy
discovery.docker "local" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "api_logs" {
  targets = discovery.docker.local.targets

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    regex         = sys.env("ALLOY_DOCKER_COMPOSE_PROJECT")
    action        = "keep"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    regex         = "api"
    action        = "keep"
  }

  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "compose_service"
  }
}

loki.source.docker "api_logs" {
  host             = "unix:///var/run/docker.sock"
  targets          = discovery.relabel.api_logs.output
  refresh_interval = "5s"
  labels = {
    source = "docker",
  }
  forward_to = [loki.process.api_logs.receiver]
}

loki.process "api_logs" {
  stage.json {
    expressions = {
      environment = "",
      event       = "",
      level       = "",
      module      = "",
      reasonCode  = "",
      requestId   = "",
      service     = "",
      spanId      = "",
      timestamp   = "",
      traceId     = "",
    }
  }

  stage.timestamp {
    source            = "timestamp"
    format            = "RFC3339Nano"
    action_on_failure = "skip"
  }

  stage.labels {
    values = {
      environment = "",
      level       = "",
      service     = "",
    }
  }

  stage.structured_metadata {
    values = {
      event      = "",
      module     = "",
      reasonCode = "",
      requestId  = "",
      spanId     = "",
      traceId    = "",
    }
  }

  forward_to = [loki.write.local.receiver]
}

loki.write "local" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}

otelcol.receiver.otlp "api" {
  http {
    endpoint = "0.0.0.0:4318"
  }

  output {
    traces = [otelcol.processor.batch.traces.input]
  }
}

otelcol.processor.batch "traces" {
  timeout         = "1s"
  send_batch_size = 512

  output {
    traces = [otelcol.exporter.otlphttp.tempo.input]
  }
}

otelcol.exporter.otlphttp "tempo" {
  client {
    endpoint = "http://tempo:4318"
  }
}
```

Do not add `traceId`, `spanId`, `requestId`, event, module or reason code to
`stage.labels`.

- [ ] **Step 4: Create Loki and Tempo configuration**

Create Loki:

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  log_level: info

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem

limits_config:
  allow_structured_metadata: true
  retention_period: 168h

analytics:
  reporting_enabled: false
```

Create Tempo:

```yaml
stream_over_http_enabled: true

server:
  http_listen_port: 3200
  log_level: info

distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: 0.0.0.0:4318

compactor:
  compaction:
    block_retention: 168h

storage:
  trace:
    backend: local
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/blocks

usage_report:
  reporting_enabled: false
```

- [ ] **Step 5: Create Grafana datasource provisioning**

Create:

```yaml
apiVersion: 1

deleteDatasources:
  - name: Loki
    orgId: 1
  - name: Tempo
    orgId: 1

datasources:
  - name: Loki
    type: loki
    uid: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    editable: false
    jsonData:
      derivedFields:
        - name: TraceID
          matcherRegex: '"traceId":"([a-f0-9]{32})"'
          datasourceUid: tempo
          url: '$${__value.raw}'

  - name: Tempo
    type: tempo
    uid: tempo
    access: proxy
    url: http://tempo:3200
    editable: false
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: -5m
        spanEndTimeShift: 5m
        filterByTraceID: true
        filterBySpanID: false
        customQuery: true
        query: '{service="$${__resource.service.name}"} |="$${__span.traceId}"'
      streamingEnabled:
        search: true
```

Mount only the datasource directory, not `/etc/grafana/provisioning`.

- [ ] **Step 6: Add observability services and volumes**

Append services:

```yaml
loki:
  image: grafana/loki:3.7.2@sha256:191d4fdfb7264f16989f0a57f320872620a5a7c2ceeec6229212c4190ec49b86
  profiles:
    - observability
  command:
    - -config.file=/etc/loki/local-config.yaml
  volumes:
    - ./config/observability/loki/loki.yaml:/etc/loki/local-config.yaml:ro
    - loki-data:/loki

tempo:
  image: grafana/tempo:2.10.7@sha256:032b3acb51ed02c4b801473d54bb63e9e9f13738d215126d9843c30283794f4b
  profiles:
    - observability
  command:
    - -config.file=/etc/tempo/tempo.yaml
  volumes:
    - ./config/observability/tempo/tempo.yaml:/etc/tempo/tempo.yaml:ro
    - tempo-data:/var/tempo

alloy:
  image: grafana/alloy:v1.18.0@sha256:491b0578c04983fd54fe99b587b6fab4404dc46d0dc16677bd6b00cc1140b308
  profiles:
    - observability
  command:
    - run
    - --server.http.listen-addr=0.0.0.0:12345
    - --storage.path=/var/lib/alloy/data
    - /etc/alloy/config.alloy
  environment:
    ALLOY_DOCKER_COMPOSE_PROJECT: ${COMPOSE_PROJECT_NAME:-nest-js-starter}
  depends_on:
    loki:
      condition: service_started
    tempo:
      condition: service_started
  ports:
    - '127.0.0.1:${OTLP_HTTP_PORT:-4318}:4318'
  volumes:
    - ./config/observability/alloy/config.alloy:/etc/alloy/config.alloy:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro

grafana:
  image: grafana/grafana:13.1.0@sha256:121a7a9ece6dc10b969f1f96eed64b4f07dfac0d0b8abc070f7cb83bbde86f63
  profiles:
    - observability
  environment:
    GF_ANALYTICS_CHECK_FOR_UPDATES: 'false'
    GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES: 'false'
    GF_ANALYTICS_REPORTING_ENABLED: 'false'
    GF_AUTH_ANONYMOUS_ENABLED: 'true'
    GF_AUTH_ANONYMOUS_ORG_ROLE: Editor
    GF_AUTH_DISABLE_LOGIN_FORM: 'true'
    GF_PLUGINS_PLUGIN_ADMIN_ENABLED: 'false'
    GF_PLUGINS_PREINSTALL_AUTO_UPDATE: 'false'
    GF_PLUGINS_PREINSTALL_DISABLED: 'true'
    GF_USERS_ALLOW_SIGN_UP: 'false'
  depends_on:
    loki:
      condition: service_started
    tempo:
      condition: service_started
  ports:
    - '127.0.0.1:${GRAFANA_PORT:-3004}:3000'
  volumes:
    - ./config/observability/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources:ro
    - grafana-data:/var/lib/grafana
```

Add named volumes:

```yaml
volumes:
  grafana-data:
  loki-data:
  postgres-data:
  redis-coordination-data:
  tempo-data:
```

- [ ] **Step 7: Add host port inputs**

Append to `.env.example`:

```dotenv
OTLP_HTTP_PORT=4318
GRAFANA_PORT=3004
```

Keep `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` for explicit host mode;
Compose overrides the API container endpoint.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run the Task 2 Step 2 Jest command.

Expected: PASS for migrator/API and observability contracts.

- [ ] **Step 9: Resolve Compose without starting containers**

Run:

```bash
docker compose \
  --project-name nest-js-starter-contract \
  --env-file .env.example \
  --profile development \
  --profile observability \
  config \
  --quiet
```

Expected: exit `0` with no unknown-field or interpolation error.

- [ ] **Step 10: Commit Task 3**

```bash
git add .env.example docker-compose.yml \
  config/observability \
  test/unit/ops/local-compose-runtime-contract.spec.ts
git commit -m "feat(observability): add local logs and traces stack"
```

---

### Task 4: Document the canonical local workflow and failure boundaries

**Files:**

- Create: `docs/runbooks/local-development.md`
- Modify: `README.md`
- Modify: `docs/architecture/errors-logging-observability.md`
- Modify: `docs/runbooks/telemetry-collector-loss.md`

**Interfaces:**

- Consumes: commands, ports, Watch paths, retention and failure semantics from
  Tasks 1–3.
- Produces: one canonical operator flow and troubleshooting contract.

- [ ] **Step 1: Replace the README local happy path**

Use this command sequence:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

State that `pnpm dev` starts PostgreSQL, Redis, one-shot migrator, watched API,
Alloy, Loki, Tempo and Grafana. Link
`docs/runbooks/local-development.md`. Preserve the initial-admin and project
gate sections.

- [ ] **Step 2: Create the operational local-development runbook**

Document these exact sections:

```markdown
# Local development

## Happy path

## Actual process and persistence boundary

## Grafana Explore

## Change and restart matrix

## Host debugging escape hatch

## Complete shutdown

## Collector/storage/UI failures

## Occupied ports and Docker socket

## Local data retention
```

The happy path must name:

- API readiness: `http://127.0.0.1:3000/health/ready`;
- Grafana Explore: `http://127.0.0.1:3004/explore`;
- shutdown: `pnpm dev:down`;
- host escape hatch preparation:
  `docker compose up -d --wait postgres redis-coordination`,
  `pnpm start:migrate`, then `pnpm dev:host`.

Include this restart matrix:

| Change                          | Action                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `src/**`                        | Compose sync; Nest recompiles inside existing API container      |
| package/lock/workspace manifest | rebuild and recreate only API                                    |
| Prisma schema/config            | rebuild API; restart full workflow to rerun committed migrations |
| Nest/TypeScript config          | sync and restart only API container                              |
| `.env`                          | `pnpm dev:down`, then `pnpm dev`                                 |
| observability config            | restart the affected vendor service                              |
| ordinary stop/start             | named-volume data remains                                        |

State explicitly that `pnpm dev:down` preserves named volumes and that deletion
is a separate destructive operation not provided by a package script.

- [ ] **Step 3: Extend architecture documentation**

Add:

```text
Nest API --Pino JSON stdout--> Docker logs --> Alloy --> Loki --> Grafana
Nest API --trace-only OTLP/HTTP-------------> Alloy --> Tempo --> Grafana
```

Document low-cardinality labels, structured metadata, seven-day local
retention, loopback ports, the Docker socket boundary and the absence of
observability readiness dependencies.

- [ ] **Step 4: Update collector-loss recovery**

Add a local subsection with:

```sh
docker compose --profile observability stop alloy
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
docker compose --profile observability start alloy
```

State that the first command is a deliberate local drill, API readiness must
remain healthy and new traces resume only after Alloy restarts.

- [ ] **Step 5: Format only changed Markdown files**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node \
  node_modules/prettier/bin/prettier.cjs \
  README.md \
  docs/architecture/errors-logging-observability.md \
  docs/runbooks/local-development.md \
  docs/runbooks/telemetry-collector-loss.md \
  --write
```

Expected: only the four named files are formatted.

- [ ] **Step 6: Check documentation consistency**

Run:

```bash
rg -n 'pnpm dev|dev:api|dev:host|dev:down|4318|3004|168h|migrator' \
  README.md \
  docs/architecture/errors-logging-observability.md \
  docs/runbooks/local-development.md \
  docs/runbooks/telemetry-collector-loss.md
```

Expected: every command and port appears in the intended owner document; no
text says that `dev:host` provides centralized logs/traces or that API runs
migrations.

- [ ] **Step 7: Commit Task 4**

```bash
git add README.md \
  docs/architecture/errors-logging-observability.md \
  docs/runbooks/local-development.md \
  docs/runbooks/telemetry-collector-loss.md
git commit -m "docs(dev): document observable local workflow"
```

---

### Task 5: Validate static contracts and build the development target

**Files:**

- Modify only files from Tasks 1–4 when a validation failure identifies a real
  defect.

**Interfaces:**

- Consumes: complete static implementation.
- Produces: fresh resolved Compose, unit, development-image and repository-gate
  evidence before runtime smoke.

- [ ] **Step 1: Inspect the complete implementation diff**

Run:

```bash
git diff stage...HEAD --stat
git diff --check
git status --short --branch
```

Expected: the branch contains the approved design, this plan and files in the
File Map; no `backend-codex`, workflow or lockfile change exists.

- [ ] **Step 2: Run the two focused unit contracts together**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs \
  --runInBand \
  test/unit/toolchain/standard-nest-development-start.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

Expected: 2 suites PASS with 0 failed tests.

- [ ] **Step 3: Resolve the complete Compose model**

Run:

```bash
docker compose \
  --project-name nest-js-starter-contract \
  --env-file .env.example \
  --profile development \
  --profile observability \
  config \
  --quiet
```

Expected: exit `0`; no interpolation, unknown-field or path error.

- [ ] **Step 4: Pull the exact vendor images once**

Run:

```bash
docker compose \
  --project-name nest-js-starter-contract \
  --env-file .env.example \
  --profile observability \
  pull alloy loki tempo grafana
```

Expected: all four exact digest references resolve. Do not run four independent
pull commands.

- [ ] **Step 5: Build the shared local development image once**

Run:

```bash
docker compose \
  --project-name nest-js-starter-build \
  --env-file .env.example \
  --profile development \
  build api
```

Expected: target `development` builds once, keeps non-root ownership and is
reused by both API and migrator.

- [ ] **Step 6: Run the required repository gate**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 run check:quick
```

Expected: formatting, Prisma validation/generation, OpenAPI drift/lint, ESLint,
typecheck, all unit tests, architecture and compiled build exit `0`.

- [ ] **Step 7: Commit validation fixes only if needed**

If Steps 1–6 required code/config/doc corrections, stage only the corrected
owners and create:

```bash
git commit -m "fix(observability): align local runtime contracts"
```

Do not create an empty validation commit.

---

### Task 6: Prove migrations, signals, fail-open behavior, Watch and persistence

**Files:**

- No planned source changes.
- Modify the owning Task 1–4 files only if runtime evidence exposes a real
  implementation defect.

**Interfaces:**

- Consumes: exact images and static evidence from Task 5.
- Produces: bounded runtime acceptance evidence for every behavior that static
  tests cannot prove.

- [ ] **Step 1: Confirm isolated ports without killing owners**

Check ports `33000`, `33004`, `34318`, `35432`, `36379`. If any is occupied,
choose another five-port set and use it consistently for this task; do not stop
or kill the existing owner.

- [ ] **Step 2: Start the isolated stack**

Run with task-scoped environment:

```bash
API_PORT=33000 \
GRAFANA_PORT=33004 \
OTLP_HTTP_PORT=34318 \
POSTGRES_PORT=35432 \
REDIS_PORT=36379 \
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile development \
  --profile observability \
  up --detach --build \
  api alloy loki tempo grafana
```

Expected: Compose pulls in PostgreSQL, Redis and migrator through dependencies;
no service from another project is changed.

- [ ] **Step 3: Prove migration ordering and API readiness**

Run:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile development \
  --profile observability \
  ps --all
```

Require:

- `migrator` exited with code `0`;
- API is running only after that exit;
- PostgreSQL and Redis are healthy.

Poll without a fixed long sleep:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node -e '
const url = "http://127.0.0.1:33000/health/ready";
for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    const response = await fetch(url);
    if (response.ok) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error("API readiness timeout");
'
```

Expected: exit `0` within 60 seconds.

- [ ] **Step 4: Verify provisioned datasources**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node -e '
const response = await fetch("http://127.0.0.1:33004/api/datasources");
if (!response.ok) throw new Error(`Grafana returned ${response.status}`);
const datasources = await response.json();
const loki = datasources.find(({ uid }) => uid === "loki");
const tempo = datasources.find(({ uid }) => uid === "tempo");
if (loki === undefined || tempo === undefined) {
  throw new Error("Missing Loki or Tempo datasource");
}
const derivedField = loki.jsonData?.derivedFields?.find(
  ({ datasourceUid }) => datasourceUid === "tempo",
);
if (derivedField?.url !== "${__value.raw}") {
  throw new Error("Loki derived trace link is not provisioned");
}
const tracesToLogs = tempo.jsonData?.tracesToLogsV2;
if (
  tracesToLogs?.datasourceUid !== "loki" ||
  tracesToLogs?.filterByTraceID !== true ||
  !tracesToLogs?.query?.includes("${__span.traceId}")
) {
  throw new Error("Tempo trace-to-logs is not provisioned");
}
'
```

Expected: exit `0` with both UIDs, literal correlation expressions and no
manual Grafana setup.

- [ ] **Step 5: Send a correlated request with a forbidden secret fixture**

Use a fixed valid W3C trace ID and a unique request ID:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node -e '
const response = await fetch("http://127.0.0.1:33000/health/ready", {
  headers: {
    authorization: "Bearer observability-smoke-secret",
    cookie: "session=observability-smoke-secret",
    traceparent:
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    "x-request-id": "019219c3-dc52-7cc1-9e70-f293ca14c299",
  },
});
if (!response.ok) throw new Error(`API returned ${response.status}`);
'
```

Expected: request succeeds; secret fixture is never printed in task output.

- [ ] **Step 6: Query Loki through the loopback Grafana proxy**

Poll:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node -e '
const base = "http://127.0.0.1:33004/api/datasources/proxy/uid/loki/loki/api/v1/query_range";
const query = new URL(base);
query.searchParams.set("query", `{service="nest-js-starter"} |= "019219c3-dc52-7cc1-9e70-f293ca14c299"`);
query.searchParams.set("limit", "20");
for (let attempt = 1; attempt <= 60; attempt += 1) {
  const response = await fetch(query);
  if (response.ok) {
    const body = await response.json();
    const lines = body.data?.result?.flatMap(({ values }) =>
      values.map(([, line]) => line),
    ) ?? [];
    const match = lines.find((line) =>
      line.includes("019219c3-dc52-7cc1-9e70-f293ca14c299"),
    );
    if (match !== undefined) {
      if (match.includes("observability-smoke-secret")) {
        throw new Error("Secret fixture reached Loki");
      }
      const record = JSON.parse(match);
      if (!/^[a-f0-9]{32}$/u.test(record.traceId ?? "")) {
        throw new Error("Loki record has no traceId");
      }
      process.stdout.write(`${record.traceId}\\n`);
      process.exit(0);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error("Correlated Loki record timeout");
'
```

Expected: prints only the 32-hex trace ID; no secret fixture or complete log
payload is printed.

- [ ] **Step 7: Query Tempo through the Grafana proxy**

Use the trace ID printed by Step 6:

```bash
TRACE_ID=0123456789abcdef0123456789abcdef \
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/node -e '
const traceId = process.env.TRACE_ID;
const response = await fetch(
  `http://127.0.0.1:33004/api/datasources/proxy/uid/tempo/api/traces/${traceId}`,
);
if (!response.ok) throw new Error(`Tempo returned ${response.status}`);
const body = JSON.stringify(await response.json());
if (!body.includes("nest-js-starter")) {
  throw new Error("Trace service identity is missing");
}
if (body.includes("observability-smoke-secret")) {
  throw new Error("Secret fixture reached Tempo");
}
const lokiUrl = new URL(
  "http://127.0.0.1:33004/api/datasources/proxy/uid/loki/loki/api/v1/query_range",
);
lokiUrl.searchParams.set(
  "query",
  `{service="nest-js-starter"} |= "${traceId}"`,
);
const lokiResponse = await fetch(lokiUrl);
if (!lokiResponse.ok) {
  throw new Error(`Trace-to-logs query returned ${lokiResponse.status}`);
}
const lokiBody = await lokiResponse.json();
if ((lokiBody.data?.result?.length ?? 0) === 0) {
  throw new Error("Trace-to-logs query found no correlated log");
}
'
```

Replace the example `TRACE_ID` value with the Step 6 output. Expected: exit
`0`, correct service identity, no secret fixture and the same service/trace ID
query used by Grafana finds a Loki record.

- [ ] **Step 8: Verify collector fail-open and recovery**

Stop only Alloy:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile observability \
  stop alloy
```

Probe:

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:33000/health/live
curl --fail --silent --show-error \
  http://127.0.0.1:33000/health/ready
```

Expected: both requests succeed. Restart only Alloy:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile observability \
  start alloy
```

Send a new trace and repeat the bounded Loki/Tempo query to prove recovery.

- [ ] **Step 9: Verify data persistence**

Restart only storage/UI:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile observability \
  restart loki tempo grafana
```

Poll Grafana health and repeat the Step 6/7 queries for the previously recorded
request and trace. Expected: both remain queryable.

- [ ] **Step 10: Verify Compose Watch with one reversible source change**

Record infrastructure container IDs:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile development \
  --profile observability \
  ps --format json
```

Start `docker compose watch --no-up api` for the same isolated project in a
bounded terminal session. Use `apply_patch` to insert this line immediately
after `import 'dotenv/config'` in `src/bootstrap/api/main.ts`:

```ts
// Compose Watch acceptance marker.
```

Require Nest recompilation in API logs. Re-read container IDs and require that
PostgreSQL, Redis, Alloy, Loki, Tempo and Grafana IDs are unchanged. Use
`apply_patch` to remove the exact marker, wait for the second successful Nest
recompilation, and require `git status --short` to return to its pre-smoke
state.

- [ ] **Step 11: Clean up only the isolated project**

Run:

```bash
docker compose \
  --project-name nest-js-starter-observability-smoke \
  --env-file .env.example \
  --profile development \
  --profile observability \
  down --volumes --remove-orphans
```

Expected: only `nest-js-starter-observability-smoke` containers, network and
test-owned volumes are removed. The developer's default project and all other
Docker projects remain untouched.

- [ ] **Step 12: Commit runtime fixes only if needed**

If runtime validation exposed and fixed a defect, stage only its owning files:

```bash
git commit -m "fix(observability): harden local runtime behavior"
```

Do not create an empty smoke commit.

---

### Task 7: Run final evidence gate and prepare handoff

**Files:**

- Modify only files required by a failed final gate.

**Interfaces:**

- Consumes: all task commits and runtime evidence.
- Produces: fresh completion evidence and a clean local handoff; no external
  publication.

- [ ] **Step 1: Re-run focused contracts if runtime fixes changed files**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 exec jest \
  --config jest.unit.config.mjs \
  --runInBand \
  test/unit/toolchain/standard-nest-development-start.spec.ts \
  test/unit/ops/local-compose-runtime-contract.spec.ts
```

Expected when run: 2 suites PASS, 0 failures. If Task 6 changed no repository
file, retain the fresh Task 5 focused-test evidence instead of repeating it.

- [ ] **Step 2: Re-run the required project gate if runtime fixes changed files**

Run:

```bash
/Users/denischernykh/.nvm/versions/node/v24.18.0/bin/corepack \
  pnpm@11.15.1 run check:quick
```

Expected when run: command exits `0` and supersedes Task 5 evidence. If Task 6
changed no repository file, Task 5 remains the final `check:quick` evidence for
the unchanged source state.

- [ ] **Step 3: Verify final repository state**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no unstaged/staged implementation changes remain; branch is
`feat/unified-local-observability`; no push or PR exists from this plan.

- [ ] **Step 4: Review acceptance criteria line by line**

Require evidence for:

- one-command services and successful migrator-before-API;
- Watch source sync without infrastructure recreation;
- healthy API with Alloy stopped;
- Loki log, Tempo trace and Grafana correlation;
- persistence after storage/UI restart;
- loopback-only ports and exact image digests;
- vendor services reaching native readiness with committed configs;
- resolved Compose/unit tests and `pnpm check:quick`;
- documentation for commands, restart rules, retention and failures;
- absence of Amazing EKB product boundaries.

- [ ] **Step 5: Report the local-only handoff**

Report exact:

- branch and commits;
- changed files;
- focused test and `check:quick` results;
- isolated runtime evidence;
- Grafana URL and datasource UIDs;
- what restarts for source, dependency, Prisma, env and vendor config changes;
- any limitation discovered;
- explicit statement that push, PR and merge were not performed.

## Plan Review and Execution Strategy

### Recommended model

Use `gpt-5.6-sol` with `reasoning_effort=high` for Tasks 1–7.

Reasons:

- the implementation spans Dockerfile, resolved Compose semantics, four vendor
  configuration languages, Grafana correlation and multi-container runtime
  evidence;
- most risk is cross-boundary reasoning rather than code volume;
- `high` retains enough reasoning for dependency and failure analysis while
  avoiding the latency of `xhigh` on routine file adaptation;
- escalate only the runtime-debugging turn to `xhigh` if a native service is
  unhealthy after three evidence-driven hypotheses, rather than using `xhigh`
  for the whole implementation.

`gpt-5.6-terra` is suitable for isolated documentation or mechanical edits but
is not recommended as the sole executor because a mistaken Compose dependency,
Loki label or Grafana escape can survive superficial static review and cost a
full runtime rerun.

### Execution mode

Use inline `superpowers:executing-plans` in the current branch. Do not split the
implementation across parallel agents:

- Tasks 1–4 modify shared files and form a strict dependency chain.
- Task 6 needs one persistent Docker project and a single evidence owner.
- Agent handoff/review overhead is larger than the expected mechanical-edit
  savings for this seven-task slice.

### How Codex will reduce implementation time without quality loss

1. Keep the implementation in this task and model context. Do not hand the work
   to another agent or switch models between mechanical edits, Docker
   configuration and runtime evidence.
2. Reuse the already inspected Amazing EKB vendor configs and immutable image
   pins, changing only project identity and the `api` service allowlist; do not
   repeat repository research already captured by the approved design.
3. Batch independent read-only inspections and exact vendor pulls where the
   tools allow it, but keep file writes and Docker lifecycle operations
   sequential because they share state.
4. Reuse one resolved Compose test helper for migrator, Watch, images, ports,
   mounts and volumes instead of adding YAML parsers or multiple suites.
5. Apply focused patches task-by-task and run one narrow RED/GREEN test for
   each contract. Avoid repeated whole-repository checks during mechanical
   edits.
6. Add no dependencies and no runtime-smoke helper; use Node 24 `fetch`, Docker
   Compose and Grafana's datasource proxy.
7. Pull vendor images once, build the development image once and use one
   isolated Docker project to prove migration ordering, correlation, collector
   outage, recovery, persistence and Watch.
8. Run `pnpm check:quick` once after the static implementation batch. Repeat it
   only if runtime diagnosis causes a source/config change.
9. Keep full integration/e2e suites out of the critical path because no
   application TypeScript behavior changes; focused contracts,
   `pnpm check:quick` and the real inter-container smoke cover this slice.

### Self-review result

- Spec coverage: every goal, non-goal, command, failure boundary, persistence
  rule and acceptance criterion maps to Tasks 1–7.
- Dependency graph: `development image` → `migrator/API` → `observability` →
  `docs` → `static gate` → `runtime smoke` → `final gate`.
- Type/name consistency: service names, datasource UIDs, ports, paths and
  package scripts are identical across tests, Compose, docs and smoke commands.
- Scope: production/deployment design and verification are deliberately
  excluded; no workflow, dependency, lockfile, generated contract or Amazing
  EKB product change is planned.
