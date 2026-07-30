# Deployment Preparation Runbook Design

## Goal

Add one canonical runbook that makes a backend repository ready for a future
Dokploy deployment without installing Dokploy, changing a VPS, or performing a
deployment. The runbook must serve both a new backend created from this starter
and the immediate atomic adoption of the same preparation contract in
`backend-codex`.

## Audience and operating modes

The primary reader is an AI agent performing repository adoption under human
approval. A human operator must also be able to use the same document as a
readiness checklist.

The runbook has two explicit modes:

1. **Fresh descendant:** a backend starts from the current starter and replaces
   starter-owned identity values before its first Stage publication.
2. **Existing backend adoption:** an agent audits `backend-codex`, maps every
   target-owned value, ports the preparation contracts atomically, and proves a
   target-owned GHCR publication without preserving a starter compatibility
   path.

Both modes converge on the same repository-ready and environment-input-ready
evidence. The existing backend mode adds audit and replacement steps; it does
not define a second deployment architecture.

## Scope boundary

The preparation runbook owns:

- target identity discovery and replacement;
- GitHub Actions and GHCR publication prerequisites;
- the immutable OCI image, Trivy, and OCI smoke contract;
- production configuration and secret inventory;
- PostgreSQL migration/runtime role separation;
- coordination Redis durability requirements;
- domain, TLS, trusted-proxy, telemetry, and backup decisions;
- evidence required before a future Dokploy setup begins.

The runbook does not:

- install, upgrade, or configure Dokploy;
- create a Dokploy project, application, API key, or deployment;
- mutate a VPS, DNS record, hosted PostgreSQL, Redis, telemetry, or S3 service;
- generate or expose real credentials;
- approve a mutable image tag for deployment;
- copy a historical starter or product image digest as evidence.

The handoff ends at a documented input bundle for
`docs/runbooks/dokploy-deployment.md`.

## Readiness levels

The document distinguishes two levels so repository work is not confused with
hosted runtime evidence.

### Repository ready

Repository readiness requires:

- target-owned repository, package, service, and Redis-prefix identities;
- a `stage` publication workflow with least-privilege `GITHUB_TOKEN`
  permissions;
- a non-root `linux/amd64` OCI image with target-owned source and revision
  labels;
- one successful target Stage run that publishes by commit SHA, captures an
  immutable digest, passes Trivy, pulls that digest, and passes OCI smoke;
- configuration validation and all repository gates passing;
- no real secrets or target connection URLs committed.

The first successful push creates the GHCR package; the runbook must not tell an
operator to pre-create a container package manually. Package visibility,
repository linkage, Actions access, and organization policy still require an
explicit post-publication check.

### Environment inputs ready

Environment-input readiness records ownership and expected values without
provisioning the future host:

- controlled public API domain and expected HTTPS origin set;
- future trusted reverse-proxy CIDRs;
- separate PostgreSQL migrator and runtime identities;
- authoritative persistent coordination Redis with AOF, backup, ACL, and
  `noeviction` requirements;
- four independent 32-byte base64url auth secrets stored only in the chosen
  secret provider;
- telemetry decision and endpoint ownership;
- off-host PostgreSQL backup owner, schedule, retention, and isolated restore
  policy;
- GHCR pull policy for the future Dokploy application.

For a private GHCR package, the document records that the future external pull
credential is a dedicated identity with a personal access token (classic)
limited to `read:packages`. The token is created only during the authorized
Dokploy setup window, not during repository preparation. Public GHCR packages
need no pull credential. A public visibility change is treated as an explicit,
irreversible operator decision.

## Canonical flow

The runbook presents one linear flow:

1. Freeze the target repository and authority boundary.
2. Inventory target-owned identity and configuration values.
3. Audit the target against the starter source-of-truth files.
4. Replace starter identity atomically; never retain dual starter/product
   values.
5. Verify GitHub Actions and GHCR permissions.
6. Merge through a regular pull request into `stage`.
7. Require the Stage workflow sequence:
   full gate, build, GHCR push, Trivy scan of the immutable digest, pull by
   digest, OCI smoke, digest capture.
8. Confirm package access and record the approved digest/revision pair.
9. Verify production configuration, database-role, Redis, domain/TLS,
   telemetry, and backup input contracts.
10. Produce a redacted readiness record and stop before Dokploy.

Trivy is a mandatory publication gate. It scans vulnerabilities in the
published digest, includes `HIGH` and `CRITICAL`, ignores findings without a
known fix, and fails the workflow when remaining findings exist. A digest that
was pushed but belongs to a failed Trivy or smoke run exists in GHCR but is not
approved for deployment.

## Target identity manifest

Before editing, the adopting agent records these names without secret values:

- GitHub owner and repository;
- source repository HTTPS URL;
- Stage branch;
- GHCR image name;
- OCI title and service name;
- service version and revision source;
- public API URL and allowed browser origins;
- coordination Redis key prefix;
- PostgreSQL database and role names;
- future backup bucket/prefix owner;
- future deployment environment name.

The runbook uses symbolic examples such as `<github-owner>` and
`<repository-name>`. It must not contain an approved historical digest,
production URL, connection string, API key, cookie, password, or token.

## Existing backend adoption contract

For `backend-codex`, the agent must first inspect the target checkout, branch,
dirty state, workflows, Dockerfile, package scripts, environment schema,
migrations, runtime lifecycle, existing registry packages, and product-local
infrastructure. The agent preserves product modules and module-local
boundaries.

The agent then classifies each starter contract:

- **adopt:** missing target capability is copied and renamed for the target;
- **reconcile:** an equivalent target capability is retained after its
  invariants are proven;
- **reject:** a starter-specific identity, digest, URL, secret, or obsolete
  compatibility path is not copied.

Acceptance requires fresh target evidence. Starter CI results, starter GHCR
digests, and previous deployment evidence never prove `backend-codex`
readiness.

## Source-of-truth map

The runbook points the agent to the current contracts instead of duplicating
their implementation:

- `.github/workflows/stage-image.yml` for publication order and permissions;
- `Dockerfile` for platform, non-root runtime, entrypoint, and OCI labels;
- `package.json` and `scripts/oci/run-image-smoke.ts` for local OCI checks;
- `.env.example` and
  `src/platform/config/runtime-environment.schema.ts` for deployment inputs;
- `docs/runbooks/deployment-database-roles.md` for PostgreSQL roles;
- `docs/runbooks/deployment-security.md` for public perimeter and Redis;
- `docs/runbooks/postgres-backup-restore.md` for backup ownership;
- `docs/runbooks/stage-image-publication.md` for publication semantics;
- `docs/runbooks/dokploy-deployment.md` for the later deployment adapter.

The new runbook is orchestration documentation. Existing focused runbooks
remain authoritative for their detailed commands and failure handling.

## Documentation changes

Create:

- `docs/runbooks/deployment-preparation.md` — canonical preparation and adoption
  runbook.

Modify:

- `README.md` — add a direct preparation entry to the repository guide;
- `docs/runbooks/stage-image-publication.md` — name the preparation runbook as a
  prerequisite and clarify the Trivy approval boundary;
- `docs/runbooks/dokploy-deployment.md` — require the redacted preparation
  evidence before any Dokploy mutation.

No application code, workflow, Dockerfile, dependency, environment schema, or
generated artifact changes are required.

## Verification

Verification uses the repository-pinned Node `24.18.0` and pnpm `11.15.1`:

1. Run Prettier against every changed Markdown file.
2. Verify that every repository-relative link in the new runbook resolves.
3. Search the new runbook for historical GHCR digests, starter-owned GHCR image
   references, real credentials, connection URLs, and incomplete markers.
4. Confirm that the documented Stage sequence matches
   `.github/workflows/stage-image.yml`, including Trivy settings and
   pull-before-smoke order.
5. Run `pnpm check:quick`.

The final report distinguishes documentation verification from any unperformed
GHCR, VPS, Dokploy, database, Redis, DNS, or S3 operation.
