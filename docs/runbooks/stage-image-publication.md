# Stage image publication

Complete Steps 1–4 of
[deployment-preparation.md](deployment-preparation.md) before treating this
workflow as a target-owned publication contract. Then run the target Stage
workflow and return to Steps 5–9 to close publication, package and environment
evidence. A fresh backend must replace starter identity before this run; an
existing backend must produce its own target evidence.

The pull-request workflow runs `pnpm check` only; it does not build or publish
an image. A push to `stage` runs the read-only gate first, then the publisher
job with GHCR package write permission.

The publisher builds the non-root runtime image for `linux/amd64` with public
`BUILD_REVISION`, `BUILD_SOURCE` and `BUILD_CREATED` metadata, pushes the
lowercase GHCR repository under the commit SHA, and exposes the immutable
BuildKit digest. It scans that digest with Trivy at High/Critical severity and
then pulls the same published digest from GHCR before running the one compact
OCI smoke helper against that digest reference. The binding order is
`Trivy -> pull same published digest -> OCI smoke`.

The push creates or updates the GHCR package before those gates finish. A digest
from a failed Trivy or OCI smoke step exists in the registry but is not approved
for deployment.

The smoke covers failed migration isolation, successful migration/readiness,
auth problem output, runtime non-root/filesystem invariants and clean SIGTERM.
There is no custom registry-attestation reader, evidence bundle or digest
resolver. Deployment consumers must use the captured digest, never a mutable
tag.
