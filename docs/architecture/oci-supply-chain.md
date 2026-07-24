# OCI supply-chain contract

## Ownership and roles

The repository owns one Dockerfile and one runtime image. The same immutable
image runs one role at a time:

- API: `node dist/bootstrap/api/main.js`;
- migrator: `corepack pnpm@11.15.1 run start:migrate`.

The API never migrates on startup. An orchestrator must run the migrator to a
successful exit before starting or replacing API replicas. The root Compose
file supplies local PostgreSQL and Redis only; it is not a deployment model.

The runtime stage is non-root, receives Unix signals through an exec-form
command and contains compiled output, production dependencies, Prisma schema
and migration configuration. Source, tests, development compilers, `.env` and
Git metadata are absent.

## Identity and build boundary

Dockerfile frontend, Node base and external GitHub actions are immutable pins
reviewed in `scripts/oci/oci-pins.json`. A pin update resolves a stable upstream
release to its exact SHA/digest, updates the human-readable tag annotation and
passes mutation-based policy tests. Mutable action tags and image tags are not
trusted inputs.

Build arguments are public metadata, never secrets. `BUILD_REVISION`,
`BUILD_SOURCE` and `BUILD_CREATED` are copied into OCI labels and therefore
visible to registry readers. Credentials and runtime configuration may enter
only when a container starts.

The `stage-image` workflow uses a read-only gate job for the complete repository
check. Only its dependent publisher can receive `packages: write`. Workflow
`concurrency.queue: max` preserves every pending stage SHA, while a fail-closed
registry preflight rejects an existing SHA tag before `push: true`. The
publisher derives the lowercase GHCR name, builds `linux/amd64` once, pushes one
exact-SHA tag and captures the action-produced digest. The
`GHCR digest is normative` and `SHA tags are non-deployment pointers` are
mandatory rules. A tag must never be
passed to a deployment target. Promotion resolves the existing SHA tag,
confirms the digest and `org.opencontainers.image.revision`, then hands off the
digest reference without rebuild.

## Evidence and verification

BuildKit registry attestations attach an SPDX SBOM and SLSA v1 max provenance
to the exact digest. The workflow reads those documents back from GHCR rather
than trusting only local build output. It also scans the digest—not the tag—with
Trivy vulnerability scanning limited to High/Critical and `ignore-unfixed`.
Trivy exceptions are explicit and reviewable; a scanner exception belongs in a
separate security review and is never encoded as a silent workflow bypass.

The downloadable evidence bundle contains:

- `image-evidence.json` with image, digest, digest reference, revision and
  OpenAPI SHA-256;
- `sbom.spdx.json` read from the exact registry digest;
- `provenance.json` read from the exact registry digest;
- `trivy.json` for the immutable digest;
- the committed `docs/api/openapi.json` whose hash is in image evidence.

Native GitHub artifact attestations for private repositories require GitHub
Enterprise Cloud. This repository does not pretend that feature is enabled:
its current contract is registry-attached BuildKit attestations and a bounded
Actions evidence artifact.

## Threat and deployment boundary

The PR workflow has only `contents: read`; it cannot publish packages. The stage
workflow defaults to `contents: read`; its full gate inherits that read-only
scope, and only the dependent publisher job adds `packages: write` for the
repository `GITHUB_TOKEN`. It publishes after the full gate, names no GitHub
Environment and performs no Dokploy mutation. Slice 7 must consume an already
verified digest and defines environment approval, rollout and recovery
separately.

Registry tags can move, Actions artifacts expire and scan databases evolve.
The durable handoff is the Git revision plus captured digest, corroborated by
the OCI revision label, structurally validated registry attestations and
evidence hashes. A rerun cannot overwrite an existing SHA tag: it fails before
the build. Missing evidence must be recovered through read-only inspection or a
reviewed repair workflow, never by replacing a previously selected digest.
