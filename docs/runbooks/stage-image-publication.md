# Stage image publication

Complete [deployment-preparation.md](deployment-preparation.md) before treating
this workflow as a target-owned publication contract. A fresh backend must
replace starter identity first; an existing backend must produce its own
target evidence.

The pull-request workflow runs `pnpm check` only; it does not build or publish
an image. A push to `stage` runs the read-only gate first, then the publisher
job with GHCR package write permission.

The publisher builds the non-root runtime image for `linux/amd64` with public
`BUILD_REVISION`, `BUILD_SOURCE` and `BUILD_CREATED` metadata, pushes the
lowercase GHCR repository under the commit SHA, and exposes the immutable
BuildKit digest. It scans that digest with Trivy at High/Critical severity and
runs the one compact OCI smoke helper against the digest reference.

The push creates or updates the GHCR package before those gates finish. A digest
from a failed Trivy or OCI smoke step exists in the registry but is not approved
for deployment.

The smoke covers failed migration isolation, successful migration/readiness,
auth problem output, runtime non-root/filesystem invariants and clean SIGTERM.
There is no custom registry-attestation reader, evidence bundle or digest
resolver. Deployment consumers must use the captured digest, never a mutable
tag.
