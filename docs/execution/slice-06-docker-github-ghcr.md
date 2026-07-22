# Slice 6 Docker, GitHub Actions and GHCR execution evidence

Date: 2026-07-22

Branch: `feat/docker-github-ghcr`

Verified implementation commit: `b7c7986`

Base: `stage` at `8feb0ff`

## Verified local toolchain

- Node.js: `24.18.0` activated through the existing nvm installation without
  changing the global default.
- pnpm: `11.15.1` through Corepack.
- Docker client/server: `29.4.3`.
- Docker Buildx: `0.33.0-desktop.1`.
- Docker Compose: `5.1.3`.
- Dockerfile frontend:
  `docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`.
- Node base:
  `node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573`.

Node, base-image, dependency and action stable versions were resolved again on
the execution date before implementation. Immutable action SHAs and their
reviewed stable tags are recorded in `scripts/oci/oci-pins.json`.

## Final local gates

All commands ran from the repository root with Node `24.18.0`:

```bash
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 run check:quick
OPENAPI_BREAKING_BASE_REF=origin/stage \
  TESTCONTAINERS_REUSE_ENABLE=false \
  corepack pnpm@11.15.1 run check
corepack pnpm@11.15.1 run oci:check
git diff --check
```

Results:

- frozen install: exit `0`, lockfile already current;
- `check:quick`: exit `0`; 78 unit suites / 628 tests, 3 generator suites /
  52 tests, 2 golden suites / 2 tests and 1 architecture suite / 44 tests;
- OpenAPI breaking/client/conformance gates: exit `0`; conformance 2 suites /
  12 tests;
- integration: 13 suites / 58 tests;
- e2e: 26 suites / 82 tests;
- aggregate coverage: 117 suites / 768 tests, statements `90.51%`, branches
  `85.98%`, functions `88.69%`, lines `90.51%`;
- auth application branches `90.80%`, session infrastructure `90.91%`,
  presentation guards `91.80%`;
- complete `check`, including its final OCI gate: exit `0`;
- independent final `oci:check`: exit `0`;
- `git diff --check`: exit `0`.

## Local image evidence

The final independent OCI run built `nest-js-starter:smoke` with public fixture
metadata only:

- local image ID/reference digest:
  `sha256:f233cc65e699cc89bc226d875b37cc50baae2c17b416d02ac40a1e0ce8b304aa`;
- user: `node`, numeric runtime identity `uid=1000`, `gid=1000`;
- exec-form default command: `node dist/bootstrap/api/main.js`;
- revision label: `0000000000000000000000000000000000000000`;
- source label: `https://github.com/DenisChernykh/nest-js-starter`.

Required runtime paths existed: `/app/dist`, `/app/node_modules`,
`/app/package.json`, `/app/prisma` and `/app/prisma.config.ts`. Forbidden or
development paths did not exist: `/app/src`, `/app/test`, `/app/coverage`,
`/app/.env`, `/app/.git`, `tsx`, `tsc` and the TypeScript package.

The smoke proved:

- an invalid database migration exits non-zero and does not start the API;
- the same image completes the real Prisma migrator role;
- the API reaches readiness only after migration and dependencies;
- `GET /v1/auth/me` returns the documented `401` problem contract;
- `docker stop --time 15` produces a clean API exit;
- project-scoped teardown removes volumes and containers. No
  `nest-js-starter-smoke-*` containers remained after the final run.

Image history contains only the public revision/source/created build arguments;
no runtime credential or `.env` value was supplied as a build argument. The
local index digest is diagnostic, not a deployable remote identity. BuildKit
attestation metadata can produce a different local index digest on a separate
build, which is why the stage workflow builds once and captures its exact
registry digest.

## Implemented remote contract

- Pull requests to `stage` run the full gate with `contents: read` and no write
  permission.
- Pushes to `stage` run the full gate before registry mutation, publish one
  `linux/amd64` SHA tag, capture its digest, scan that digest and upload image,
  Trivy, SBOM, provenance and OpenAPI evidence.
- Buildx registry readers reject empty/malformed SPDX or SLSA data.
- `oci:resolve` reads an existing exact SHA tag, verifies its digest and OCI
  revision label and has no build/tag/push fallback.

The feature branch did not push an image and does not claim GHCR success.
Registry publication, Trivy database results and readable attached
attestations require the user-owned merge commit on `stage`.

## External limitations and post-merge evidence

- The repository is private. Native GitHub artifact attestations for private
  repositories require GitHub Enterprise Cloud; this slice uses BuildKit
  registry-attached attestations and the Actions evidence artifact.
- Repository branch-protection inspection was unavailable to the current plan
  (`403`); workflow policy is enforced in source and mutation tests, without
  changing repository settings.
- No GitHub Environment, Dokploy mutation, package visibility change or
  organization/repository permission mutation belongs to this slice.

After merge, append or follow up with evidence for the exact `stage` merge SHA:

1. `Stage image` workflow URL and run ID;
2. lowercase GHCR SHA tag and captured `sha256` digest;
3. successful fixable High/Critical Trivy gate and artifact ID;
4. non-empty registry SPDX and SLSA v1 max provenance reads;
5. `image-evidence.json` OpenAPI SHA-256 equality with the committed artifact;
6. successful `oci:resolve` output for the same merge SHA and digest.

Slice 7 must not start until this existing exact digest is proven.
