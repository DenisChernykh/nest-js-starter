# Deployment Operator CLI Design

## Goal

Replace the repeatable shell mechanics in the deployment runbooks with one
repository-owned TypeScript operator CLI while preserving the existing
human-owned readiness, migration-compatibility, rollback and incident
decisions.

The starter is the executable reference implementation. `backend-codex`
receives adoption documentation only in this slice; no starter CLI code is
copied into that repository.

## Current state

The repository already provides the stable deployment contract:

1. a merge into `stage` runs the full repository gate;
2. GitHub Actions builds and publishes a non-root `linux/amd64` image to GHCR;
3. Trivy scans the immutable digest;
4. the publisher pulls the same digest and runs the OCI smoke against its exact
   Git revision;
5. the operator runs Prisma migrations from the approved image with a dedicated
   migrator credential;
6. Dokploy receives the complete runtime environment and exact digest;
7. the operator polls one identified deployment and runs an external
   health/auth smoke;
8. rollback is allowed only after proving that the previous API is compatible
   with the already-applied schema.

The current Dokploy adapter implements these mechanics as copyable shell blocks
inside Markdown. Candidate and rollback pins must be edited manually, external
response handling is difficult to test, and execution evidence is assembled by
hand. Those operational mechanics move into the CLI. The focused runbooks
remain authoritative for policy, ownership and exceptional decisions.

The unified local observability stack added after the original deployment
runbooks remains development-only. Local Alloy, Loki, Tempo and Grafana are not
production readiness dependencies and are not provisioned or deployed by this
CLI.

## Scope

The slice adds:

- a versioned non-secret release manifest;
- a TypeScript CLI with `preflight`, `promote` and `rollback` commands;
- dry-run as the default for promotion;
- an explicit `--apply` capability for live mutations;
- Docker, Dokploy HTTP, migrator and external-smoke adapters;
- fail-closed polling and environment restoration;
- redacted machine-readable execution evidence;
- unit tests and local mock HTTP tests that require no VPS;
- focused runbook updates that replace copyable happy-path shell with CLI
  commands;
- a standalone `backend-codex` adoption guide explaining an atomic later port.

The slice does not:

- create, install, upgrade or configure a VPS or Dokploy instance;
- create DNS, TLS, PostgreSQL, Redis, telemetry or backup resources;
- add a GitHub deployment workflow or self-hosted runner;
- expose PostgreSQL or Redis to a GitHub-hosted runner;
- publish a new GHCR image solely to exercise the CLI;
- execute a hosted deployment, rollback or restore drill;
- generate production credentials;
- place secrets, connection URLs or complete Dokploy environments in Git;
- automatically choose or execute rollback after promotion failure;
- introduce a second deployment architecture or compatibility mode.

## Chosen architecture

The implementation is a toolchain feature under `scripts/deployment`. It does
not enter `src`, application modules or platform composition.

```text
release manifest
      |
deployment CLI
      +-- manifest and environment validation
      +-- Docker image adapter
      +-- one-shot migrator adapter
      +-- Dokploy HTTP adapter
      +-- bounded deployment poller
      +-- external health/auth smoke adapter
      +-- redacted evidence writer
```

The orchestration layer depends on explicit ports for Docker, migration,
Dokploy, time/sleep and external smoke. Production adapters implement the ports;
tests use deterministic fakes or a loopback mock HTTP server. Every
hand-written exported TypeScript contract receives TSDoc according to
`docs/architecture/tsdoc-guidelines.md`.

No new runtime or development dependency is required. The manifest and process
environment use the repository's exact existing Joi `18.2.3` dependency, HTTP
uses the built-in `fetch`, CLI parsing stays deliberately small, and child
processes use `node:child_process`.

## Commands

Package scripts expose these commands:

```sh
pnpm deployment:preflight --manifest path/to/release.json
pnpm deployment:promote --manifest path/to/release.json
pnpm deployment:promote --manifest path/to/release.json --apply --evidence path/to/promotion-evidence.json
pnpm deployment:rollback --manifest path/to/release.json --apply --evidence path/to/rollback-evidence.json
```

`deployment:preflight` performs offline manifest validation and emits a
redacted readiness summary. It never calls Docker, Dokploy, PostgreSQL or the
public API.

`deployment:promote` defaults to dry-run. Without `--apply`, it validates the
same inputs, prints the exact ordered plan using only non-secret identifiers,
and exits without instantiating external adapters.

`deployment:promote --apply` performs the approved promotion sequence.

`deployment:rollback` has no dry-run-to-apply escalation hidden inside
promotion. It is a separate operator action, requires `--apply`, and refuses to
start without rollback schema-compatibility evidence.

Unknown flags, missing flag values, multiple manifest paths or a command/flag
combination outside this contract exit non-zero before external work.

## Release manifest

The committed example and operator-created release manifest use schema version
`1`:

```json
{
  "schemaVersion": 1,
  "environment": "stage",
  "repository": "DenisChernykh/nest-js-starter",
  "candidate": {
    "imageRef": "ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "revision": "1111111111111111111111111111111111111111",
    "workflowRunUrl": "https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789"
  },
  "rollback": {
    "imageRef": "ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "revision": "2222222222222222222222222222222222222222",
    "schemaCompatibilityEvidence": "change-review/rollback-compatibility"
  },
  "publicApiUrl": "https://stage-api.example.com"
}
```

The schema requires:

- `schemaVersion` exactly `1`;
- `environment` as a non-empty stable deployment name;
- `repository` in case-preserving GitHub `owner/name` form;
- candidate and rollback `imageRef` values in lowercase
  `ghcr.io/owner/name@sha256:` form followed by exactly 64 lowercase
  hexadecimal characters;
- both image repositories to equal the lowercased manifest repository;
- candidate and rollback digests to differ;
- both revisions to contain exactly 40 lowercase hexadecimal characters;
- a credential-free HTTPS GitHub Actions run URL under the manifest repository;
- non-empty rollback schema-compatibility evidence;
- a credential-free HTTPS public API base URL without query or fragment.

The parser uses strict objects and rejects unknown keys. The manifest therefore
cannot contain likely secret-bearing fields such as database URLs, tokens,
passwords, API keys, cookies or a serialized Dokploy environment. Validation
errors identify field paths but never echo rejected values.

The committed example contains non-routable symbolic evidence and is never an
approved deployment candidate.

## Secret and environment contract

Live inputs exist only in the inherited operator environment:

```text
DOKPLOY_BASE_URL
DOKPLOY_API_KEY
DOKPLOY_APPLICATION_ID
DOKPLOY_APPLICATION_ENV
DOKPLOY_PREVIOUS_APPLICATION_ENV
GHCR_REGISTRY_URL
GHCR_USERNAME
GHCR_PASSWORD
MIGRATION_DATABASE_URL
RUNTIME_DATABASE_URL
```

Apply mode validates presence and cross-field invariants without printing
values:

- `DOKPLOY_BASE_URL` is credential-free HTTPS;
- `GHCR_REGISTRY_URL` identifies `ghcr.io`;
- the complete `DOKPLOY_APPLICATION_ENV` contains exactly one
  `DATABASE_URL` equal to `RUNTIME_DATABASE_URL`;
- it contains exactly one `SERVICE_REVISION` equal to the candidate revision;
- GHCR and database credentials never appear in child-process arguments;
- migration receives `DATABASE_URL` through the child environment only.

The CLI does not load `.env`, accept secret-valued flags or serialize process
environment into evidence. Operators inject secrets through their approved
local secret process now and a future protected self-hosted runner later.

## Promotion data flow

Apply mode performs one linear fail-closed sequence:

1. parse CLI arguments, manifest and live environment;
2. validate the release contract before any external call;
3. create an isolated temporary Docker config with mode `0700`;
4. authenticate to private GHCR with `--password-stdin`;
5. pull the exact candidate digest;
6. inspect `org.opencontainers.image.revision` and require an exact match;
7. remove isolated registry credentials;
8. run `prisma migrate deploy` from the same candidate image with
   `MIGRATION_DATABASE_URL` mapped only to the child `DATABASE_URL`;
9. stop without Dokploy mutation if the migrator exits non-zero;
10. snapshot Dokploy deployments for the application;
11. save the complete candidate runtime environment;
12. save the private GHCR provider with the exact candidate digest;
13. invoke `application.deploy` with a revision-bound title;
14. fetch deployments again and identify exactly one new record with that
    title;
15. poll only the identified deployment every five seconds until the
    ten-minute absolute deadline;
16. accept only `done`; treat `error`, `cancelled`, unknown, missing and
    duplicate states as failure;
17. call the public `/health/live`, `/health/startup` and `/health/ready`
    endpoints and require `200`;
18. call `/v1/auth/me` without a cookie and require the expected RFC 9457
    `401 AUTHENTICATION_REQUIRED` response;
19. atomically write redacted success evidence.

The operator host must reach GHCR, the Dokploy HTTPS API, the migration
PostgreSQL endpoint and the public API. Direct SSH access to the VPS is not a
runtime requirement. Production PostgreSQL and Redis remain private; the
design never recommends exposing either service to the internet.

## Failure and restoration behavior

All external operations have bounded timeouts. A network exception, non-2xx
response, malformed body or unexpected response shape is a deployment failure,
not a retry instruction.

Before the first Dokploy mutation, the CLI already holds the protected complete
previous environment. After candidate environment mutation starts, any provider
save, deploy request, deployment identification or polling failure triggers one
bounded attempt to restore the previous complete environment. Restoration
success or failure is recorded without values. A restoration failure is marked
critical and preserves the original non-zero outcome.

An external smoke failure occurs after the adapter has reached `done`. The CLI
also attempts to restore the previous environment, then stops and requires the
human rollback/roll-forward decision.

The CLI never:

- retries mutations indefinitely;
- picks the newest deployment when identification is ambiguous;
- interprets `running` at the deadline as success;
- runs a database down-migration;
- invokes rollback automatically;
- claims recovery based on an empty Dokploy mutation response.

Temporary Docker auth directories and partial evidence files are removed on
normal exit, error and supported termination signals. Deployment snapshots stay
in process memory and are discarded on exit.

## Rollback data flow

Rollback is a separate explicit command:

1. validate the same manifest;
2. require non-empty reviewed schema-compatibility evidence;
3. require live credentials and the protected previous complete environment;
4. authenticate and pull the exact rollback digest;
5. verify its OCI revision;
6. restore the previous complete environment;
7. save the rollback digest as the Docker provider;
8. deploy, identify one new record and poll it with the same fail-closed rules;
9. repeat the external health/auth smoke;
10. atomically write redacted rollback evidence.

Rollback never runs the migrator. If schema compatibility is not established,
the command refuses to perform any external action and directs the operator to
the roll-forward decision in `docs/runbooks/rollback.md`.

## Evidence

Successful and failed apply executions write a JSON document to an
operator-selected path. The CLI refuses to overwrite an existing evidence
file. It writes a mode-`0600` temporary sibling and renames it atomically.

Evidence contains only:

- schema version and operation (`promote` or `rollback`);
- environment and repository;
- candidate and rollback image digests and revisions;
- workflow run URL;
- UTC start/end timestamps;
- ordered step names and redacted outcomes;
- Dokploy deployment ID and terminal status when one was identified;
- migration exit outcome;
- environment restoration attempted/succeeded booleans;
- four external smoke outcomes;
- final CLI outcome.

Evidence excludes:

- inherited environment;
- request/response headers;
- response bodies unrelated to the bounded public smoke contract;
- registry username and password;
- API keys;
- database or Redis URLs;
- cookies, user data and complete Dokploy environment text.

Dry-run output is not hosted evidence and is not written as a successful apply
record.

## Test strategy

Implementation follows test-driven development.

Focused unit tests cover:

- strict manifest parsing and all cross-field invariants;
- secret-like and unknown field rejection without value disclosure;
- CLI argument parsing and dry-run external-call isolation;
- exact promotion and rollback ordering;
- migration failure before all Dokploy mutations;
- candidate/rollback distinction and schema-compatibility gate;
- polling transitions `running -> done`, `running -> error`,
  `running -> cancelled`, timeout and unknown state;
- missing or duplicate deployment identification;
- previous-environment restoration after every post-mutation failure point;
- external smoke success and each failure;
- evidence redaction, permissions, no-overwrite and atomic rename;
- prohibition of automatic rollback.

A loopback mock Dokploy server verifies:

- `x-api-key` authentication without logging the value;
- paths, methods and bounded response schemas;
- empty-object mutation responses;
- deployment snapshots and polling;
- malformed JSON, non-2xx and timeout handling.

Docker and migrator behavior use injected command adapters in unit tests. The
existing OCI smoke remains the authoritative real-image gate; this slice does
not duplicate it.

The implementation gate is:

```sh
corepack pnpm@11.15.1 run check:quick
```

No hosted PASS, environment readiness or deployment success is reported from
mock or local evidence.

## Runbook changes

`docs/runbooks/deployment.md` becomes the human policy and decision entrypoint.
It links the manifest contract, uses the CLI for preflight/promotion, and keeps
migration compatibility and change-window ownership.

`docs/runbooks/dokploy-deployment.md` documents required environment injection,
the CLI command, Dokploy API assumptions and diagnostics. The current long
happy-path shell implementation is removed after equivalent CLI tests exist.

`docs/runbooks/rollback.md` keeps the human schema decision and calls the
separate rollback command only after approval.

`docs/runbooks/deployment-preparation.md` gains the manifest/evidence handoff
and states that the CLI does not provision infrastructure.

The existing database-role, Redis-loss, secret-compromise, telemetry-loss and
PostgreSQL restore runbooks remain focused and are not converted into CLI
subcommands.

## `backend-codex` adoption documentation

The starter adds a standalone guide for the later product adoption. The guide
requires an atomic target-owned port:

- inspect the exact `backend-codex` checkout, branch, dirty state and current
  deployment contracts;
- preserve all product modules and module-local hexagonal boundaries;
- classify each starter file or contract as `adopt`, `reconcile` or `reject`;
- replace repository, GHCR, OCI title, service, Redis prefix, PostgreSQL role,
  public problem namespace and telemetry identities;
- regenerate target-owned example manifests and tests;
- retain no starter digest, URL, secret, compatibility alias or historical
  evidence;
- run fresh target gates and target Stage publication before accepting any
  manifest;
- stop before push, PR, hosted mutation or deployment unless those actions are
  separately authorized.

This slice writes the guide only. Actual `backend-codex` inspection, code
changes, tests and publication form a later separately authorized task.

## Future GitHub Actions integration

GHCR remains the immutable artifact boundary in every execution mode:

```text
GitHub repository -> Stage workflow -> GHCR image@digest
                                         |
                              deployment operator CLI
                                         |
                                    Dokploy/VPS
```

After a real hosted drill, a protected manually dispatched GitHub workflow may
invoke the same CLI from a self-hosted runner inside the private deployment
network. That future workflow must not duplicate orchestration logic. A
GitHub-hosted runner is not accepted as a reason to expose PostgreSQL or Redis
publicly.

## Acceptance

The slice is accepted when:

1. dry-run proves through tests that it makes no external calls;
2. apply orchestration is fully covered against deterministic adapters and a
   loopback Dokploy mock;
3. secrets and connection URLs cannot enter manifest, diagnostics or evidence;
4. migration failure provably precedes all Dokploy mutation;
5. promotion never performs automatic rollback;
6. rollback requires explicit schema-compatibility evidence and never migrates;
7. runbooks delegate only repeatable mechanics to the CLI and retain policy;
8. the `backend-codex` guide describes documentation-only future adoption;
9. `pnpm check:quick` passes on Node `24.18.0` and pnpm `11.15.1`;
10. the final report explicitly states that no VPS, Dokploy, DNS, hosted
    PostgreSQL/Redis, GHCR publication or deployment was mutated.
