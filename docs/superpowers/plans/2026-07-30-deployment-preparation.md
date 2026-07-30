# Deployment Preparation Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical pre-Dokploy readiness runbook for new starter
descendants and atomic adoption in `backend-codex`.

**Architecture:** One orchestration runbook defines repository readiness,
environment-input readiness, the existing-backend adoption protocol, and the
redacted handoff bundle. Existing focused runbooks remain the source of truth
for database roles, security, backup, image publication, and the later Dokploy
adapter; short links make the new entry point discoverable.

**Tech Stack:** Markdown, GitHub Actions, Docker/OCI, GHCR,
`aquasecurity/trivy-action`, PostgreSQL/Prisma, Redis, Node `24.18.0`, pnpm
`11.15.1`.

## Global Constraints

- Do not install, configure, or call Dokploy and do not mutate a VPS, DNS,
  PostgreSQL, Redis, telemetry, or S3 service.
- Do not generate, print, commit, or request real credentials, connection URLs,
  cookies, passwords, API keys, or tokens.
- Do not copy a starter or historical product digest, repository name, URL,
  Redis prefix, secret, or deployment evidence into a target acceptance record.
- A fresh backend and `backend-codex` converge on one atomic target-owned
  contract; do not add a dual starter/product compatibility path.
- Preserve product modules and module-local hexagonal boundaries during
  `backend-codex` adoption.
- Treat `.github/workflows/stage-image.yml`, `Dockerfile`, `.env.example`, the
  runtime environment schema, and focused runbooks as sources of truth.
- Trivy is mandatory: scan the published immutable digest for fixable `HIGH`
  and `CRITICAL` vulnerabilities, fail on remaining findings, then pull the
  digest and run OCI smoke.
- A pushed digest from a failed Trivy or smoke run exists in GHCR but is not
  approved for deployment.
- Use only repository-pinned Node `24.18.0` and pnpm `11.15.1` for verification.
- Finish with `pnpm check:quick`; documentation checks do not prove any hosted
  operation occurred.

---

### Task 1: Add the canonical preparation and adoption runbook

**Files:**

- Create: `docs/runbooks/deployment-preparation.md`
- Reference:
  `docs/superpowers/specs/2026-07-30-deployment-preparation-design.md`
- Reference: `.github/workflows/stage-image.yml`
- Reference: `Dockerfile`
- Reference: `.env.example`
- Reference: `src/platform/config/runtime-environment.schema.ts`
- Reference: `docs/runbooks/deployment-database-roles.md`
- Reference: `docs/runbooks/deployment-security.md`
- Reference: `docs/runbooks/postgres-backup-restore.md`
- Reference: `docs/runbooks/stage-image-publication.md`
- Reference: `docs/runbooks/dokploy-deployment.md`

**Interfaces:**

- Consumes: the current source-of-truth contracts listed above.
- Produces: `docs/runbooks/deployment-preparation.md`, the single pre-Dokploy
  entry point linked by Task 2.

- [ ] **Step 1: Prove the runbook is currently absent**

Run:

```bash
test ! -e docs/runbooks/deployment-preparation.md
```

Expected: exit code `0`.

- [ ] **Step 2: Re-read the exact publication and runtime inputs before
      writing**

Run:

```bash
sed -n '1,120p' .github/workflows/stage-image.yml
sed -n '17,45p' Dockerfile
sed -n '1,80p' .env.example
sed -n '173,247p' src/platform/config/runtime-environment.schema.ts
```

Expected:

- the Stage publisher uses `packages: write` and `GITHUB_TOKEN`;
- image identity is derived from lowercased `GITHUB_REPOSITORY`;
- order is build/push, Trivy, pull by digest, OCI smoke, print digest;
- production runtime is non-root and carries OCI source/revision labels;
- production validation requires HTTPS public/CORS origins, at least one
  trusted proxy CIDR, a non-logical coordination Redis database, and four
  distinct decoded secrets.

- [ ] **Step 3: Create the runbook with the exact operating boundary**

Create `docs/runbooks/deployment-preparation.md` with this heading order:

```markdown
# Подготовка backend к будущему deployment

## Назначение и граница

## Два режима применения

## Уровни готовности

## Шаг 1. Зафиксировать authority и target identity

## Шаг 2. Провести аудит существующего backend

## Шаг 3. Адаптировать repository-owned контракты

## Шаг 4. Подготовить GitHub Actions и первую публикацию GHCR

## Шаг 5. Проверить Trivy, OCI smoke и immutable digest

## Шаг 6. Подготовить production configuration contract

## Шаг 7. Зафиксировать PostgreSQL, Redis и backup contracts

## Шаг 8. Подготовить будущие public perimeter inputs

## Шаг 9. Сформировать redacted readiness record

## Stop gate перед Dokploy

## Source-of-truth map
```

Write the document in Russian, keeping exact technical identifiers in English.
State at the top that it prepares repository contracts and a future input
bundle but performs no Dokploy, VPS, DNS, database, Redis, telemetry, or S3
mutation.

Under `Два режима применения`, define:

```text
Fresh descendant:
replace every starter-owned identity before the first Stage publication.

Existing backend adoption:
audit the target, classify each contract as adopt/reconcile/reject, preserve
product modules, replace identity atomically, and require fresh target evidence.
```

Under `Уровни готовности`, define separate acceptance:

```text
Repository ready:
the target repository has passed its own Stage publication through Trivy and
OCI smoke and has an approved target-owned digest/revision pair.

Environment inputs ready:
owners and non-secret expected values are recorded for domain/TLS/proxy,
PostgreSQL roles, persistent Redis, auth secrets, telemetry, backup, and future
GHCR pull access; hosted resources are not claimed as provisioned.
```

- [ ] **Step 4: Add the target identity manifest and adoption rules**

Include one table with these rows:

```markdown
| Input                  | Target-owned value to record                            | Source to inspect        |
| ---------------------- | ------------------------------------------------------- | ------------------------ |
| GitHub repository      | `<github-owner>/<repository-name>`                      | `git remote -v`          |
| Source URL             | `https://github.com/<github-owner>/<repository-name>`   | OCI source contract      |
| Stage branch           | `stage`                                                 | repository policy        |
| GHCR image             | `ghcr.io/<github-owner>/<repository-name>` in lowercase | Stage workflow           |
| OCI title              | target service name                                     | `Dockerfile`             |
| Service identity       | service name, version and revision source               | `.env.example`           |
| Public boundary        | future HTTPS API URL and browser origins                | environment schema       |
| Redis namespace        | target-owned key prefix                                 | environment schema       |
| PostgreSQL identities  | target database, migrator and runtime roles             | database-role runbook    |
| Backup ownership       | future bucket/prefix owner and retention owner          | backup runbook           |
| Deployment environment | human-owned non-production/production name              | future operator decision |
```

Make clear that angle-bracket values are symbolic examples, not values to copy.
Require the agent to inspect checkout, branch/HEAD/dirty state, remotes,
workflows, Dockerfile, scripts, runtime environment schema, migrations,
existing registry packages, and product-local infrastructure before editing
`backend-codex`.

Define the classification without ambiguity:

```text
adopt = target capability is absent; port and rename it for the target
reconcile = target already has an equivalent capability; retain it only after
            proving every invariant
reject = do not copy starter identity, digest, URL, secret, historical evidence,
         or obsolete compatibility path
```

- [ ] **Step 5: Document GitHub/GHCR creation and approval semantics**

State all of the following:

- GitHub Actions must be enabled and organization policy must allow the pinned
  actions and package publication.
- The Stage job, not a manually created secret, receives `GITHUB_TOKEN` with
  job-scoped `contents: read` and `packages: write`.
- The first successful push creates the GHCR container package automatically;
  operators do not pre-create the package.
- The post-publication package check covers repository linkage, Actions access,
  visibility, and organization policy.
- A new personal-account package is private by default. Making it public is an
  explicit irreversible operator decision.
- A public GHCR package can be pulled anonymously.
- A future private-package pull from Dokploy uses a dedicated identity and a
  personal access token (classic) limited to `read:packages`; create that token
  only in the later authorized Dokploy setup window.
- Record no token value or registry password in the runbook/readiness record.

Link to the official primary sources:

```markdown
[GitHub: Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
[GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
[GitHub: Package access and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
```

- [ ] **Step 6: Make the Trivy and immutable-digest gate executable as a
      checklist**

Document the only approved order:

```text
full repository gate
-> build linux/amd64 non-root image
-> push commit-SHA tag to target GHCR
-> scan the action-produced digest with Trivy
-> fail on fixable HIGH/CRITICAL findings
-> pull the same digest from GHCR
-> run OCI smoke against that digest and exact revision
-> record the digest/revision pair
```

State that `ignore-unfixed: true` filters findings without a known fix; it does
not convert a remaining fixable `HIGH` or `CRITICAL` finding into success.
Require the agent to verify the current pinned action and settings from the
target workflow instead of copying a version from prose.

State these failure rules:

- a PR gate does not publish or approve an image;
- `pnpm oci:check` proves a local image, not the GHCR artifact;
- a pushed digest from a failed Trivy or smoke run is unapproved;
- a tag, including the commit-SHA tag, is not a deployment reference;
- starter CI/digest evidence cannot approve `backend-codex`.

- [ ] **Step 7: Document production and infrastructure input contracts**

List the runtime variables by name without values:

```text
NODE_ENV
LOG_LEVEL
OTEL_SERVICE_NAME
SERVICE_VERSION
SERVICE_REVISION
OTEL_SDK_DISABLED
OTEL_EXPORTER_OTLP_ENDPOINT
API_HOST
API_PORT
API_DOCS_MODE
PUBLIC_API_URL
CORS_ORIGINS
TRUST_PROXY_CIDRS
DATABASE_URL
DATABASE_POOL_MAX
REDIS_COORDINATION_URL
REDIS_KEY_PREFIX
AUTH_SESSION_KEY_SECRET
AUTH_CSRF_SECRET
AUTH_RATE_LIMIT_KEY_SECRET
AUTH_NETWORK_METADATA_SECRET
```

Separate repository preparation from future secret injection:

- `NODE_ENV=production`;
- `API_DOCS_MODE` is `protected` or `off`;
- public API and CORS origins use HTTPS;
- trusted proxy CIDRs are non-empty and environment-owned;
- four auth secrets are independent 32-byte base64url values stored only in the
  future secret provider;
- the migrator receives `MIGRATION_DATABASE_URL` mapped to process-owned
  `DATABASE_URL`;
- the API receives `RUNTIME_DATABASE_URL` mapped to process-owned
  `DATABASE_URL`;
- runtime never receives the migrator credential.

Link database, security, backup, Redis-loss, secret-compromise, and telemetry
runbooks for detailed commands. Preserve these invariants in the orchestration
checklist:

- runtime PostgreSQL has application DML/sequence access but no DDL,
  migration-history mutation, ownership, or dangerous role flags;
- coordination Redis is authoritative persistent session/rate-limit state,
  uses AOF, `noeviction`, ACL, backup, and one unchanged target-owned prefix;
- no deployment or recovery step runs `FLUSHDB`/`FLUSHALL`;
- backup policy has an explicit owner, off-host target, retention, and isolated
  restore drill;
- telemetry may be disabled deliberately, but ownership of that decision is
  recorded.

- [ ] **Step 8: Add the redacted readiness record and hard stop**

Include a copyable record containing no secret slots:

```markdown
## Readiness record

- Target repository:
- Stage revision:
- Approved GHCR digest:
- OCI revision label:
- Full gate: passed/failed
- Trivy HIGH/CRITICAL gate: passed/failed
- Pull-by-digest smoke: passed/failed
- GHCR visibility/access policy: private/public and owner
- Runtime configuration contract owner:
- PostgreSQL role contract owner:
- Coordination Redis durability owner:
- Domain/TLS/proxy input owner:
- Telemetry decision owner:
- Backup/restore policy owner:
- Remaining hosted prerequisites:
```

Explain that the labels after each colon contain only identifiers, status, or
owner names; connection URLs and credentials are forbidden.

End with a fail-closed stop gate:

```text
Stop before Dokploy unless repository readiness has fresh target evidence and
every environment input has a named owner. Do not infer that Dokploy, VPS, DNS,
PostgreSQL, Redis, telemetry, or S3 exists. Continue later with
docs/runbooks/dokploy-deployment.md only under explicit hosted-operation
authorization.
```

- [ ] **Step 9: Verify the new runbook in isolation**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm exec prettier docs/runbooks/deployment-preparation.md --check
```

Expected: `All matched files use Prettier code style!`

Run:

```bash
test -e .github/workflows/stage-image.yml
test -e Dockerfile
test -e .env.example
test -e src/platform/config/runtime-environment.schema.ts
test -e docs/runbooks/deployment-database-roles.md
test -e docs/runbooks/deployment-security.md
test -e docs/runbooks/postgres-backup-restore.md
test -e docs/runbooks/stage-image-publication.md
test -e docs/runbooks/dokploy-deployment.md
```

Expected: every command exits `0`.

Run:

```bash
rg -n 'Trivy|HIGH|CRITICAL|ignore-unfixed|immutable|read:packages|backend-codex|Stop' \
  docs/runbooks/deployment-preparation.md
```

Expected: every required contract is represented.

- [ ] **Step 10: Commit the canonical runbook**

Run:

```bash
git add docs/runbooks/deployment-preparation.md
git diff --cached --check
git commit -m "docs(runbooks): add deployment preparation contract"
```

Expected: one commit containing only the new runbook.

---

### Task 2: Integrate the preparation entry point and verify the repository

**Files:**

- Modify: `README.md:86-92`
- Modify: `docs/runbooks/stage-image-publication.md:1-17`
- Modify: `docs/runbooks/dokploy-deployment.md:1-16`
- Verify: `docs/runbooks/deployment-preparation.md`

**Interfaces:**

- Consumes: `docs/runbooks/deployment-preparation.md` from Task 1.
- Produces: three discoverable links plus final repository-level verification.

- [ ] **Step 1: Prove the new entry point is not linked yet**

Run:

```bash
if rg -n 'deployment-preparation\.md' \
  README.md \
  docs/runbooks/stage-image-publication.md \
  docs/runbooks/dokploy-deployment.md; then
  exit 1
fi
```

Expected: exit code `0` and no matches.

- [ ] **Step 2: Add the README repository-guide entry**

In `README.md` under `## Repository guide`, add this bullet before the generic
`docs/runbooks/` bullet:

```markdown
- `docs/runbooks/deployment-preparation.md` — repository, GHCR and environment-input readiness before any hosted deployment;
```

- [ ] **Step 3: Add the Stage publication prerequisite and approval boundary**

After the title in `docs/runbooks/stage-image-publication.md`, add:

```markdown
Complete [deployment-preparation.md](deployment-preparation.md) before treating
this workflow as a target-owned publication contract. A fresh backend must
replace starter identity first; an existing backend must produce its own
target evidence.
```

After the paragraph describing Trivy and OCI smoke, add:

```markdown
The push creates or updates the GHCR package before those gates finish. A digest
from a failed Trivy or OCI smoke step exists in the registry but is not approved
for deployment.
```

Keep the existing statement that deployment consumers use the captured digest,
never a mutable tag.

- [ ] **Step 4: Add the Dokploy readiness prerequisite**

After the opening paragraph and official-source links in
`docs/runbooks/dokploy-deployment.md`, add:

```markdown
## Preparation prerequisite

Complete [deployment-preparation.md](deployment-preparation.md) and retain its
redacted readiness record before any mutation in this adapter. Repository
documentation alone is not hosted evidence: the record must identify a
target-owned digest/revision pair from a fully successful Stage workflow and
named owners for every environment input. Stop if Dokploy, VPS, domain/TLS,
PostgreSQL, Redis, telemetry, backup storage, or credentials are still being
inferred rather than supplied by the authorized environment owner.
```

Do not alter the adapter API calls, credentials handling, polling, or pinned
historical promotion constants in this task.

- [ ] **Step 5: Format and verify all documentation links**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm exec prettier \
  README.md \
  docs/runbooks/deployment-preparation.md \
  docs/runbooks/stage-image-publication.md \
  docs/runbooks/dokploy-deployment.md \
  --check
```

Expected: `All matched files use Prettier code style!`

Run:

```bash
rg -n 'deployment-preparation\.md' \
  README.md \
  docs/runbooks/stage-image-publication.md \
  docs/runbooks/dokploy-deployment.md
```

Expected: one repository-guide entry and one prerequisite link in each focused
runbook.

- [ ] **Step 6: Run bounded content-safety scans**

Run:

```bash
if rg -n \
  'ghcr\.io/denischernykh|sha256:[0-9a-f]{64}|postgresql://|redis://|DOKPLOY_API_KEY=|GHCR_PASSWORD=|AUTH_[A-Z_]+_SECRET=' \
  docs/runbooks/deployment-preparation.md; then
  exit 1
fi
```

Expected: exit code `0` and no secret, connection, starter-image, or historical
digest value.

Run:

```bash
if rg -n -i 'T[B]D|T[O]DO|implement l[a]ter|fill in deta[i]ls' \
  docs/runbooks/deployment-preparation.md; then
  exit 1
fi
```

Expected: exit code `0` and no incomplete marker.

- [ ] **Step 7: Compare the documented publication sequence to source**

Run:

```bash
sed -n '32,90p' .github/workflows/stage-image.yml
rg -n 'full repository gate|Trivy|pull the same digest|OCI smoke|digest/revision' \
  docs/runbooks/deployment-preparation.md
```

Expected:

- workflow order remains gate, build/push, Trivy, pull, smoke, digest output;
- runbook describes the same order and does not claim Trivy runs in the PR or
  local OCI gate.

- [ ] **Step 8: Run the required repository gate**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
  pnpm check:quick
```

Expected:

- formatting, Prisma, OpenAPI, ESLint, TypeScript, unit tests, architecture, and
  compiled build all pass;
- if sandboxed `tsx` fails with `listen EPERM`, rerun the identical command in
  a capable environment before diagnosing repository code.

- [ ] **Step 9: Review and commit the integration**

Run:

```bash
git diff --check
git diff -- README.md docs/runbooks
git status --short
```

Expected: only the three integration documents are uncommitted; the canonical
runbook was committed in Task 1.

Run:

```bash
git add \
  README.md \
  docs/runbooks/stage-image-publication.md \
  docs/runbooks/dokploy-deployment.md
git diff --cached --check
git commit -m "docs(runbooks): link deployment preparation"
```

Expected: one integration commit and a clean worktree.

- [ ] **Step 10: Record the final evidence boundary**

Run:

```bash
git status --short --branch
git log -3 --oneline
```

Expected:

- feature branch is ahead of `origin/stage` by the design, runbook, and
  integration commits;
- worktree is clean;
- final report names the exact checks run;
- final report states that no GHCR publication, VPS/Dokploy mutation, DNS
  change, hosted database/Redis operation, credential creation, or S3 operation
  occurred.
