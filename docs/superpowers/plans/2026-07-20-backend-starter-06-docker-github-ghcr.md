# NestJS Starter Docker, GitHub Actions And GHCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` inline task-by-task. This repository execution
> explicitly forbids subagents. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Собрать один production OCI image для API и migrator, проверять весь
starter в pull request и после merge в `stage` публиковать ровно один image в
GHCR по Git SHA с immutable digest, SBOM, provenance и vulnerability evidence.

**Architecture:** Multi-stage Dockerfile компилирует приложение и переносит в
non-root runtime только production dependencies, `dist`, Prisma schema,
migrations и CLI. Локальные TypeScript gates валидируют Dockerfile, action pins
и workflow semantics без GitHub/Docker side effects; отдельный Docker smoke
строит image и проверяет migrator, API readiness, runtime contents и SIGTERM.
PR workflow выполняет полный gate без registry write, а `stage` workflow после
успешного gate строит и публикует image один раз, сканирует exact digest и
сохраняет digest/SBOM/provenance/OpenAPI evidence.

**Tech Stack:** Node.js 24.18.0, pnpm 11.15.1, native TypeScript 7, Docker
Engine 29.4.3, Buildx 0.33.0, Dockerfile frontend 1.24, Docker Compose 5.1.3,
GitHub Actions, GHCR, BuildKit OCI attestations, Trivy 0.69 through
`aquasecurity/trivy-action` 0.36.0, YAML 2.9.0, Jest 30.

## Global Constraints

- Выполнять работу inline одним агентом; не использовать SDD, subagents или
  parallel agent work.
- Feature branch — `feat/docker-github-ghcr`, созданная от актуального
  `stage`; изменения вливаются в `stage` обычным merge PR. `main` продвигается
  только fast-forward от `stage`.
- Использовать exact Node `24.18.0`, pnpm `11.15.1`, full-length commit SHA для
  каждого external GitHub Action и digest-pinned Dockerfile frontend/base.
- Direct npm dependencies содержат exact stable pins без `latest`, `^` и `~`.
  Единственный новый package candidate — dev dependency `yaml@2.9.0`.
- Если Task 0 обнаружит новый stable release, changed action tag/SHA или
  несовместимость Node/Docker/runner, обновить planning snapshot отдельным
  reviewable изменением до behavior-кода; молчаливый downgrade запрещён.
- Один image используется API и migrator roles. Worker, Dokploy mutation,
  production promotion и mutable deploy aliases не входят в Slice 6.
- Image не содержит `.git`, `.env*`, `src`, `test`, `coverage`, local caches,
  TypeScript/compiler/test tools или build secrets.
- Runtime содержит `dist`, production `node_modules`, `package.json`,
  `prisma.config.ts`, `prisma/schema.prisma` и committed migrations.
- Default `CMD` запускает API как PID 1 в exec form. Migrator получает
  отдельный command override и никогда не запускается из API startup.
- Runtime запускается как numeric non-root UID/GID из official Node image;
  Dockerfile не устанавливает `sudo`, init wrapper или shell entrypoint.
- Build arguments содержат только public OCI metadata. Credentials/tokens не
  передаются через `ARG`, `ENV`, labels, cache keys или provenance.
- `docker-compose.yml` остаётся local infrastructure contract и не становится
  production deployment manifest. Application overlay существует только в
  `test/fixtures/oci`.
- PR workflow имеет только `contents: read`, не публикует package/image и не
  получает secrets через `pull_request_target`.
- Stage workflow публикует только tag, равный полному `${github.sha}`. Digest
  `ghcr.io/<lowercase-owner>/<lowercase-repo>@sha256:<64-hex>` является
  единственным handoff contract для Slice 7.
- BuildKit `provenance: mode=max,version=v1` и `sbom: true` прикрепляются к
  registry image index. Не использовать GitHub `actions/attest`: текущий
  repository private, а GitHub Artifact Attestations для private/internal
  repositories требуют Enterprise Cloud. OCI attestations BuildKit доступны
  в GHCR независимо от этого plan limitation.
- Vulnerability gate падает только на fixable `HIGH`/`CRITICAL`, использует
  Trivy vendor severity, `ignore-unfixed=true` и отдельный JSON evidence. Любое
  исключение требует committed reviewed ignore file с CVE, причиной и сроком;
  пустой broad ignore запрещён.
- Все hand-written exported TypeScript contracts получают TSDoc согласно
  `docs/architecture/tsdoc-guidelines.md`.
- `pnpm check:quick` включает offline supply-chain static gates. Полный
  `pnpm check` дополнительно выполняет image build/smoke и поэтому требует
  Docker после Slice 6.
- Не создавать GHCR package вручную, не менять visibility/billing, GitHub
  Actions settings, branch protection, environments или repository secrets в
  implementation PR. Stage publication произойдёт только после user-owned
  merge.

---

## Planning snapshot на 2026-07-22

Context7 был вызван согласно `AGENTS.md`, но вернул `Monthly quota reached`.
Ниже использованы только primary official Docker/GitHub/Node/Trivy docs,
official registries и GitHub release/tag APIs.

### Runtime and image pins

| Contract            | Exact value                                                                                        | Evidence                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Node Active LTS     | `24.18.0` (`Krypton`)                                                                              | nodejs.org release index, 2026-06-23         |
| pnpm                | `11.15.1`                                                                                          | committed package manager contract           |
| Dockerfile frontend | `docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`      | frontend 1.24.0 OCI index                    |
| Node base           | `node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573` | official Node OCI index                      |
| YAML parser         | `yaml@2.9.0`                                                                                       | npm `latest`, Node `>=14.6`, no dependencies |

### Immutable GitHub Action pins

| Action                       | Stable tag | Full commit SHA                            |
| ---------------------------- | ---------- | ------------------------------------------ |
| `actions/checkout`           | `v7.0.1`   | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node`         | `v7.0.0`   | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/upload-artifact`    | `v7.0.1`   | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `docker/setup-buildx-action` | `v4.2.0`   | `bb05f3f5519dd87d3ba754cc423b652a5edd6d2c` |
| `docker/login-action`        | `v4.4.0`   | `af1e73f918a031802d376d3c8bbc3fe56130a9b0` |
| `docker/build-push-action`   | `v7.3.0`   | `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` |
| `aquasecurity/trivy-action`  | `v0.36.0`  | `ed142fd0673e97e23eac54620cfb913e5ce36c25` |

Repository preflight:

- Feature branch `feat/docker-github-ghcr` starts at the current `stage` merge
  `8feb0ff` after hardening PR #8 and admin CLI output PR #9.
- Local toolchain is Node `24.18.0`, pnpm `11.15.1`, Docker Engine `29.4.3`,
  Buildx `0.33.0` and Docker Compose `5.1.3`.
- `DenisChernykh/nest-js-starter` is private; default branch is `main`.
- GitHub Actions enabled, external actions allowed, default workflow token is
  read-only, action SHA policy is not repository-enforced.
- Branch protection API returns the GitHub plan 403. Workflow and local static
  gates therefore enforce immutable pins, while repository-level protection is
  recorded as an external limitation rather than silently claimed.

## Result Boundary

После Slice 6 доступны:

- one-role-at-a-time OCI image with API default and migrator override;
- deterministic frozen install/build with pinned frontend/base;
- non-root runtime and direct signal delivery;
- local Docker smoke for migration, readiness, contract response, contents and
  graceful stop;
- PR full-gate workflow without write permissions;
- stage build-once workflow publishing exact SHA tag and immutable digest;
- fixable High/Critical image scan;
- registry-attached SPDX SBOM and SLSA v1 max provenance;
- downloadable `image-evidence.json`, SBOM, provenance, Trivy JSON and canonical
  OpenAPI artifact;
- exact SHA-to-existing-digest resolver used later by Slice 7 without rebuild.

Не входят stage/production Dokploy, database privilege provisioning, backup,
rollback, GitHub Environment approval, `main` promotion, worker image role,
cosign policy enforcement or public package visibility.

## Normative contracts

```ts
export interface OciPins {
  readonly dockerfileFrontend: string
  readonly nodeRuntime: string
  readonly actions: Readonly<Record<string, ActionPin>>
}

export interface ActionPin {
  readonly tag: string
  readonly sha: string
}

export interface ImageEvidence {
  readonly schemaVersion: 1
  readonly image: string
  readonly digest: `sha256:${string}`
  readonly reference: string
  readonly revision: string
  readonly openapiSha256: string
}
```

Canonical image roles:

```text
API:      node dist/bootstrap/api/main.js
Migrator: corepack pnpm@11.15.1 run start:migrate
```

Canonical stage artifact:

```text
tag:       ghcr.io/denischernykh/nest-js-starter:<40-char-stage-sha>
reference: ghcr.io/denischernykh/nest-js-starter@sha256:<64-hex-digest>
```

---

### Task 0: Repeat supply-chain preflight

**Files:**

- Read: `AGENTS.md`
- Read: `docs/architecture/module-boundaries.md`
- Read: `docs/architecture/tsdoc-guidelines.md`
- Read: `docs/architecture/runtime-lifecycle.md`
- Read: this plan and approved master design sections 16, 17, 19.5, 20, 24
- Verify: Git, Node, pnpm, Docker, Buildx, Compose, registry/action pins and
  GitHub repository capabilities

**Interfaces:**

- Consumes: merged Slice 5 plus hardening PR #8 and admin CLI output PR #9 at
  `stage` merge `8feb0ff`.
- Produces: reviewed immutable pin snapshot and external-platform limitations.

- [ ] Confirm clean `stage`, fetch/sync `origin/stage`, confirm
      `43d7a1f` ancestry and create `feat/docker-github-ghcr` exactly from stage.
- [ ] Activate nvm Node `24.18.0` without changing global default; verify pnpm
      `11.15.1`, Docker Engine, Buildx and Compose.
- [ ] Repeat nodejs.org Active LTS and Docker OCI index resolution for frontend
      and base pins.
- [ ] Repeat npm `yaml` metadata and GitHub latest-release plus tag-to-commit
      resolution for every action in the snapshot.
- [ ] Confirm repository visibility, Actions token defaults and availability of
      GHCR/Artifact Attestations/branch protection. Record limitations; do not
      mutate repository settings.
- [ ] Run baseline `pnpm check:quick` and explicit-base full `pnpm check` before
      behavior changes.

Commands:

```bash
git status --short --branch
git merge-base --is-ancestor 43d7a1fb8661582d224df8ea2a5d6317fee79e79 stage
source "$NVM_DIR/nvm.sh" && nvm use 24.18.0
node --version
corepack pnpm@11.15.1 --version
docker version
docker buildx version
docker compose version
npm view yaml version dist-tags engines dependencies --json
docker buildx imagetools inspect node:24.18.0-trixie-slim
corepack pnpm@11.15.1 run check:quick
OPENAPI_BREAKING_BASE_REF=origin/stage \
  TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 run check
```

Expected: exact pins remain stable, branch starts at `8feb0ff`, and the
pre-change gates pass. Any registry or GitHub plan drift is documented before
Task 1.

### Task 1: Pin the offline workflow validator

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml` only if minimum-release policy requires it
- Create: `scripts/oci/oci-pins.json`
- Create: `scripts/oci/validate-supply-chain.ts`
- Test: `test/unit/scripts/oci/validate-supply-chain.spec.ts`

**Interfaces:**

- Consumes: planning snapshot exact pins.
- Produces: `readOciPins(path): OciPins`,
  `validateSupplyChainFiles(input): void` and CLI `oci:validate`.

- [ ] RED: write tests proving rejection of ranged/prerelease `yaml`, mutable
      action tags, short SHA, unpinned `FROM`, `pull_request_target`, PR write
      permissions, mutable image tags and missing SBOM/provenance inputs.
- [ ] Run the narrow unit test and confirm it fails because the validator and
      pin file do not exist.
- [ ] Install exact `yaml@2.9.0` as dev dependency; update lockfile and reviewed
      pnpm release policy only if the current minimum-release gate requires it.
- [ ] Implement strict JSON pin parsing and YAML workflow validation. Every
      exported handwritten interface/function receives TSDoc. External `uses` must
      match `owner/repository@<40-hex>` and the exact SHA in `oci-pins.json`.
- [ ] Add `oci:validate` to `package.json`; include it in `check:quick` before
      lint/typecheck so malformed workflows fail early.
- [ ] GREEN: run narrow tests, `oci:validate`, exact dependency/toolchain gate
      and frozen install.
- [ ] Commit dependency plus validator baseline separately.

Core pin document:

```json
{
  "schemaVersion": 1,
  "dockerfileFrontend": "docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89",
  "nodeRuntime": "node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573",
  "actions": {
    "actions/checkout": {
      "tag": "v7.0.1",
      "sha": "3d3c42e5aac5ba805825da76410c181273ba90b1"
    },
    "actions/setup-node": {
      "tag": "v7.0.0",
      "sha": "820762786026740c76f36085b0efc47a31fe5020"
    },
    "actions/upload-artifact": {
      "tag": "v7.0.1",
      "sha": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    },
    "docker/setup-buildx-action": {
      "tag": "v4.2.0",
      "sha": "bb05f3f5519dd87d3ba754cc423b652a5edd6d2c"
    },
    "docker/login-action": {
      "tag": "v4.4.0",
      "sha": "af1e73f918a031802d376d3c8bbc3fe56130a9b0"
    },
    "docker/build-push-action": {
      "tag": "v7.3.0",
      "sha": "53b7df96c91f9c12dcc8a07bcb9ccacbed38856a"
    },
    "aquasecurity/trivy-action": {
      "tag": "v0.36.0",
      "sha": "ed142fd0673e97e23eac54620cfb913e5ce36c25"
    }
  }
}
```

Commands:

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand \
  test/unit/scripts/oci/validate-supply-chain.spec.ts
corepack pnpm@11.15.1 add --save-dev --save-exact yaml@2.9.0
corepack pnpm@11.15.1 run oci:validate
corepack pnpm@11.15.1 install --frozen-lockfile
git add package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/oci \
  test/unit/scripts/oci/validate-supply-chain.spec.ts
git commit -m "build(ci): pin supply chain validator"
```

### Task 2: Build the minimal non-root OCI image

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `scripts/oci/validate-supply-chain.ts`
- Test: `test/unit/scripts/oci/validate-supply-chain.spec.ts`

**Interfaces:**

- Consumes: `oci-pins.json`, current `build`, `start:api` and `start:migrate`
  scripts.
- Produces: Docker target `runtime`, default API command and migrator override.

- [ ] RED: add fixture-driven assertions for pinned syntax/base, named stages,
      frozen install, Prisma generation through `pnpm build`, production prune,
      required runtime copies, OCI labels, `USER node`, exec-form default command,
      and forbidden source/secrets/dev tools.
- [ ] Run the narrow test and confirm failure because Dockerfile is absent.
- [ ] Implement this Dockerfile contract, keeping all metadata args public:

```dockerfile
# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
# check=error=true

ARG NODE_IMAGE=node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack pnpm@11.15.1 install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY . .
RUN corepack pnpm@11.15.1 run build && \
    corepack pnpm@11.15.1 prune --prod

FROM ${NODE_IMAGE} AS runtime
ARG BUILD_REVISION
ARG BUILD_SOURCE
ARG BUILD_CREATED
LABEL org.opencontainers.image.title="nest-js-starter" \
      org.opencontainers.image.source="${BUILD_SOURCE}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.created="${BUILD_CREATED}"
ENV NODE_ENV=production \
    API_HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "dist/bootstrap/api/main.js"]
```

- [ ] Add `.dockerignore` entries for `.git`, `.github`, `.env*` with explicit
      no need for `.env.example`, `node_modules`, `.pnpm-store`, `dist`, `coverage`,
      logs, editor metadata and all test artifacts. Do not ignore `prisma`, source,
      package manifests or build configs needed by the builder.
- [ ] Add a build-time validation that `BUILD_REVISION` is 40 lowercase hex and
      `BUILD_SOURCE` is an HTTPS repository URL without credentials. The test
      revision `template-smoke` remains reserved for Slice 10 and is not accepted
      by this production Dockerfile path yet.
- [ ] GREEN: run static validation and Docker `--check`, then build the runtime
      target with explicit revision/source/created inputs.
- [ ] Inspect config to prove `User=node`, exec-form `Cmd`, exact OCI labels and
      absence of build-time environment values.
- [ ] Commit Docker image definition.

Commands:

```bash
corepack pnpm@11.15.1 run oci:validate
docker build --check .
docker buildx build --load --target runtime --tag nest-js-starter:smoke \
  --build-arg BUILD_REVISION=0000000000000000000000000000000000000000 \
  --build-arg BUILD_SOURCE=https://github.com/DenisChernykh/nest-js-starter \
  --build-arg BUILD_CREATED=2026-07-22T00:00:00Z .
docker image inspect nest-js-starter:smoke
git add Dockerfile .dockerignore scripts/oci/validate-supply-chain.ts \
  test/unit/scripts/oci/validate-supply-chain.spec.ts
git commit -m "build(oci): add non-root runtime image"
```

### Task 3: Prove API and migrator behavior from the same image

**Files:**

- Create: `test/fixtures/oci/docker-compose.image-smoke.yml`
- Create: `scripts/oci/run-image-smoke.ts`
- Create: `scripts/oci/smoke-support.ts`
- Test: `test/unit/scripts/oci/smoke-support.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: locally loaded `nest-js-starter:smoke`, root Compose PostgreSQL and
  coordination Redis contracts.
- Produces: CLI `oci:smoke -- --image <ref> --revision <sha>` and cleanup-safe
  project-scoped evidence.

- [ ] RED: unit-test exact project-name validation, generated test-only secrets,
      bounded HTTP readiness polling, Docker inspect parsing, runtime file denylist
      and cleanup command construction. Reject `/`, home directories, empty image
      refs and non-owned Compose project names.
- [ ] Run the narrow test and confirm the smoke helpers are missing.
- [ ] Add a Compose overlay with `migrator` and `api` using the same `${IMAGE}`.
      Migrator command is the canonical pnpm command; API uses image default CMD.
      Both consume service-name PostgreSQL/Redis URLs and generated environment
      values. API depends on successful migrator completion and healthy Redis.
- [ ] Implement the CLI with `execFile`/`spawn`, never `shell: true`. It creates
      a unique `nest-js-starter-smoke-<pid>` Compose project, writes secrets only to
      a `mkdtemp` file with mode `0600`, and always executes exact project
      `docker compose down --volumes --remove-orphans` in `finally`.
- [ ] Assert migrator exit 0, API `/health/ready` 200, one documented `/v1/auth`
      response contract, container UID non-zero, OCI revision/source labels,
      absent `/app/src`, `/app/test`, `.env` and dev binaries, then send SIGTERM via
      `docker stop --time` and assert clean exit 0.
- [ ] Ensure a failed migration never starts API; add a smoke failure mode using
      an invalid database URL and assert non-zero migrator exit.
- [ ] Add `oci:build`, `oci:smoke` and `oci:check` scripts. `oci:check` performs
      static validation, Dockerfile checks, build and smoke.
- [ ] GREEN: run unit helper tests and complete image smoke twice to prove
      cleanup/idempotency.
- [ ] Commit Docker smoke harness.

Commands:

```bash
corepack pnpm@11.15.1 exec jest --config jest.unit.config.mjs --runInBand \
  test/unit/scripts/oci/smoke-support.spec.ts
corepack pnpm@11.15.1 run oci:check
corepack pnpm@11.15.1 run oci:smoke -- \
  --image nest-js-starter:smoke \
  --revision 0000000000000000000000000000000000000000
git add package.json scripts/oci test/fixtures/oci
git commit -m "test(oci): verify api and migrator image roles"
```

### Task 4: Add the least-privilege pull request gate

**Files:**

- Create: `.github/workflows/pull-request.yml`
- Modify: `scripts/oci/validate-supply-chain.ts`
- Test: `test/unit/scripts/oci/validate-supply-chain.spec.ts`

**Interfaces:**

- Consumes: full `pnpm check`, Docker runner and explicit OpenAPI base ref.
- Produces: required-status candidate `Pull request / full-gate` without writes.

- [ ] RED: parse a fixture workflow and require only `pull_request` targeting
      `stage`, top-level `contents: read`, no job permission escalation, checkout
      `fetch-depth: 0`, exact Node file, frozen install, explicit
      `OPENAPI_BREAKING_BASE_REF=origin/stage`, disabled Testcontainers reuse and
      full `pnpm check` including OCI smoke.
- [ ] Confirm the validator fails because the workflow is absent.
- [ ] Create the workflow using only immutable action pins. Do not use
      `pull_request_target`, registry login, package write, cache restore from
      untrusted keys, secrets or deployment environments.
- [ ] Add concurrency `${{ github.workflow }}-${{ github.event.pull_request.number }}`
      with `cancel-in-progress: true`; timeout the job at 45 minutes.
- [ ] GREEN: run static workflow validation and local commands identical to the
      job on a clean checkout.
- [ ] Commit PR workflow.

Workflow skeleton:

```yaml
name: Pull request
on:
  pull_request:
    branches: [stage]
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  full-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: .node-version
          check-latest: false
      - run: corepack pnpm@11.15.1 install --frozen-lockfile
      - run: corepack pnpm@11.15.1 run check
        env:
          OPENAPI_BREAKING_BASE_REF: origin/stage
          TESTCONTAINERS_REUSE_ENABLE: 'false'
```

Commit:

```bash
git add .github/workflows/pull-request.yml scripts/oci/validate-supply-chain.ts \
  test/unit/scripts/oci/validate-supply-chain.spec.ts
git commit -m "ci(pr): run full starter gate"
```

### Task 5: Build once and publish the stage digest

**Files:**

- Create: `.github/workflows/stage-image.yml`
- Create: `scripts/oci/write-image-evidence.ts`
- Create: `scripts/oci/read-registry-attestations.ts`
- Test: `test/unit/scripts/oci/image-evidence.spec.ts`
- Modify: `scripts/oci/validate-supply-chain.ts`
- Test: `test/unit/scripts/oci/validate-supply-chain.spec.ts`

**Interfaces:**

- Consumes: a push merge commit on `stage`, GHCR `GITHUB_TOKEN`, Dockerfile and
  full gate.
- Produces: exact SHA tag, digest reference, `ImageEvidence`, SPDX SBOM, SLSA
  provenance and Trivy JSON.

- [ ] RED: test image/revision/digest validation, lowercase GHCR naming,
      canonical reference construction, OpenAPI SHA-256 and deterministic evidence
      JSON. Test registry readers with captured Buildx SBOM/provenance fixtures.
- [ ] RED: require stage workflow trigger only on `push.branches=[stage]`,
      permissions `contents:read` and `packages:write`, no deployment environment,
      full check against `${{ github.event.before }}`, one build-push step, exact
      `${{ github.sha }}` tag, `push:true`, `sbom:true`,
      `provenance:mode=max,version=v1`, digest scan and uploaded evidence.
- [ ] Implement evidence utilities with strict TSDoc contracts and no shell.
      `read-registry-attestations` invokes Buildx templates `.SBOM.SPDX` and
      `.Provenance.SLSA` for the digest reference and fails on empty/malformed data.
- [ ] Create the stage workflow with immutable action pins. Normalize
      `ghcr.io/${GITHUB_REPOSITORY}` to lowercase, derive `BUILD_CREATED` from the
      committed Git timestamp, login with `github.actor` and `secrets.GITHUB_TOKEN`,
      then run the complete gate before registry mutation.
- [ ] Build and push once for `linux/amd64`; pass public metadata args only.
      Use Buildx GitHub cache and capture `steps.build.outputs.digest`.
- [ ] Scan `${image}@${digest}` with Trivy `scanners=vuln`,
      `severity=HIGH,CRITICAL`, `ignore-unfixed=true`, `exit-code=1`, JSON output.
      Do not scan a mutable tag.
- [ ] Read and validate registry SBOM/provenance after push; write
      `image-evidence.json` and upload it with `sbom.spdx.json`, `provenance.json`,
      `trivy.json` and `docs/api/openapi.json` using `if-no-files-found:error` and
      bounded retention.
- [ ] GREEN: validate workflow and all evidence unit tests locally. Push is not
      executed from the feature branch.
- [ ] Commit stage publication workflow.

Critical Buildx inputs:

```yaml
permissions:
  contents: read
  packages: write
steps:
  - id: build
    uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
    with:
      context: .
      file: Dockerfile
      platforms: linux/amd64
      push: true
      tags: ${{ steps.image.outputs.name }}:${{ github.sha }}
      build-args: |
        BUILD_REVISION=${{ github.sha }}
        BUILD_SOURCE=${{ github.server_url }}/${{ github.repository }}
        BUILD_CREATED=${{ steps.metadata.outputs.created }}
      provenance: mode=max,version=v1
      sbom: true
      cache-from: type=gha
      cache-to: type=gha,mode=max
```

Commit:

```bash
git add .github/workflows/stage-image.yml scripts/oci \
  test/unit/scripts/oci/image-evidence.spec.ts \
  test/unit/scripts/oci/validate-supply-chain.spec.ts
git commit -m "ci(stage): publish immutable ghcr image"
```

### Task 6: Resolve an existing SHA image without rebuild

**Files:**

- Create: `scripts/oci/resolve-image-digest.ts`
- Test: `test/unit/scripts/oci/resolve-image-digest.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `--image ghcr.io/...`, `--revision <40-hex>` and authenticated
  registry access.
- Produces: one stdout line `<image>@sha256:<digest>` or non-zero exit; never
  builds, tags or pushes.

- [ ] RED: test accepted/rejected image names and revisions, manifest response
      parsing, tag-to-digest equality, revision OCI label equality, missing image,
      mutable input and mismatched label. Use injected `execFile` adapter; tests do
      not access network.
- [ ] Confirm failure because resolver is absent.
- [ ] Implement resolver using
      `docker buildx imagetools inspect <image>:<sha> --format ...`; validate the
      returned digest and `org.opencontainers.image.revision`, then print the
      digest reference only. No fallback tag, latest lookup or source rebuild.
- [ ] Add `oci:resolve` package script and a `--json` mode for Slice 7 workflow
      composition while preserving the plain reference default.
- [ ] GREEN: run unit tests and resolve a locally pushed disposable registry
      fixture if available; otherwise record remote validation as stage workflow
      evidence after merge.
- [ ] Commit digest resolver.

Commit:

```bash
git add package.json scripts/oci/resolve-image-digest.ts \
  test/unit/scripts/oci/resolve-image-digest.spec.ts
git commit -m "feat(oci): resolve existing image digest"
```

### Task 7: Integrate gates and document the supply-chain contract

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/architecture/oci-supply-chain.md`
- Create: `docs/runbooks/stage-image-publication.md`
- Modify: `docs/architecture/foundation-scope.md`
- Modify: `.env.example` only if Docker runtime needs a documented non-secret
  binding default
- Modify: `starter.manifest.json` only if its current schema gains a reviewed
  artifact contract; otherwise document why it remains unchanged

**Interfaces:**

- Consumes: all Slice 6 capabilities.
- Produces: user/operator commands, digest handoff and incident boundaries for
  Slice 7.

- [ ] RED: extend manifest/docs tests or static validator to reject README
      claims missing canonical image roles, digest-only deployment, local smoke,
      action pin update policy and private-repository attestation limitation.
- [ ] Add `oci:validate` to `check:quick`; append `oci:check` to full `check`
      after source/contract/runtime coverage gates so Docker failure is explicit.
- [ ] Update README: Docker build/run, API/migrator commands, required runtime
      environment, local smoke, PR/stage workflow behavior, digest inspection and
      statement that root Compose is not production deployment.
- [ ] Document ownership and threat model: build args are public, actions/base
      are immutable, GHCR digest is normative, tags are non-deploy pointers,
      attestations must be verified, scanner exceptions are reviewable, and stage
      publish has no Dokploy mutation.
- [ ] Add runbook for failed gate/build/push/scan/evidence upload, safe workflow
      rerun, digest inspection, package permission diagnostics and no-rebuild rule.
- [ ] Keep `starter.manifest.json` at schema v1 unless a real consumer needs OCI
      fields. Do not add speculative recipe/deployment state.
- [ ] GREEN: run docs/static/manifest gates, `pnpm check:quick` and full Docker
      `pnpm check` with explicit OpenAPI base.
- [ ] Commit docs and aggregate gate wiring.

Commit:

```bash
git add package.json README.md docs .env.example starter.manifest.json
git commit -m "docs(oci): define image supply chain"
```

### Task 8: Verify locally, publish the PR and collect remote evidence

**Files:**

- Create: `docs/execution/slice-06-docker-github-ghcr.md`
- Modify: implementation only for findings proven by final verification/review

**Interfaces:**

- Consumes: complete Slice 6 branch and GitHub repository.
- Produces: reviewed PR plus post-merge stage workflow evidence for the exact
  merge SHA.

- [ ] Run frozen install and final local gates on Node 24.18.0 with Docker:

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 run check:quick
OPENAPI_BREAKING_BASE_REF=origin/stage \
  TESTCONTAINERS_REUSE_ENABLE=false corepack pnpm@11.15.1 run check
corepack pnpm@11.15.1 run oci:check
git diff --check
```

- [ ] Inspect image config/history/filesystem, SBOM/provenance behavior in a
      disposable registry if available, and confirm no secret-bearing build args.
- [ ] Write execution evidence with Node/pnpm/Docker versions, tested commit,
      image ID/local digest, smoke results, counts, known GitHub plan limitations
      and exact commands. Do not claim GHCR publication before stage workflow.
- [ ] Commit evidence, push feature branch and create a regular PR to `stage`.
- [ ] Wait for `Pull request / full-gate`; triage every failure and Codex review
      against current code, fix valid findings with focused tests and rerun gates.
- [ ] After user-owned merge, verify `stage-image` completed for exact merge
      SHA. Confirm SHA tag resolves to the captured digest, Trivy gate passed,
      SBOM/provenance can be read from GHCR and uploaded OpenAPI hash matches the
      committed artifact.
- [ ] Append remote workflow URL/run ID, image reference/digest, artifact IDs
      and attestation verification output to execution evidence in a follow-up PR
      if post-merge evidence cannot exist in the implementation PR.
- [ ] Do not start Slice 7 until an existing exact digest is proven. Missing
      GHCR permission, exhausted Actions/package quota or unavailable required
      evidence is a real external blocker with Git/GitHub state reported exactly.

Final expected outcomes:

```text
check:quick: exit 0
check:       exit 0, including OCI smoke
PR gate:     success, no registry writes
stage gate:  success after merge
GHCR:        exact SHA tag -> captured sha256 digest
Trivy:       no fixable HIGH/CRITICAL
SBOM:        non-empty SPDX from exact digest
Provenance:  non-empty SLSA v1 mode=max from exact digest
OpenAPI:     artifact SHA-256 equals committed docs/api/openapi.json
```
