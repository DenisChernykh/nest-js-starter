# Stage image publication runbook

## Expected path

A regular pull request merges into `stage`. `Stage image` runs for the exact
merge SHA, completes `pnpm check`, publishes the lowercase GHCR SHA tag once,
scans the returned digest, reads registry attestations and uploads the five-file
evidence artifact.

Record the workflow URL/run ID, merge SHA, `image-evidence.json` reference and
digest, artifact ID, Trivy result and successful SBOM/provenance reads. Confirm
the evidence OpenAPI SHA-256 matches the committed `docs/api/openapi.json`.

Inspect an existing SHA without mutation:

```bash
corepack pnpm@11.15.1 oci:resolve -- \
  --image ghcr.io/owner/repository \
  --revision <40-hex>
```

The command must return exactly
`ghcr.io/owner/repository@sha256:<64-hex-digest>`. Operators must not rebuild for
promotion or substitute `latest` when resolution fails.

## Gate failure

Do not publish manually. Reproduce with Node `24.18.0`, pnpm `11.15.1`, Docker
and an explicit OpenAPI base:

```bash
OPENAPI_BREAKING_BASE_REF=<previous-stage-sha> \
  TESTCONTAINERS_REUSE_ENABLE=false \
  corepack pnpm@11.15.1 run check
```

Fix the failing source/contract/test in a new feature PR. A red gate is not a
registry incident because mutation occurs only afterward.

## Build or push failure

Check the immutable action/base pins, Dockerfile build-check output, GHCR login
step, Actions quota and package write permission. Never replace a failed SHA
build with a mutable tag or a workstation push. If a partial push exists,
resolve the SHA tag and compare its OCI revision label before deciding whether
the workflow can be safely rerun.

## Scan failure

Download `trivy.json` when present and identify fixable High/Critical findings.
Update the direct dependency or pinned base through review, rebuild from a new
commit and retain the original failed run as evidence. Do not change severity,
`ignore-unfixed` or `exit-code` to make the run green. Any exceptional risk
acceptance must be explicit, bounded and separately reviewed.

## Evidence upload failure

Inspect which prerequisite is missing: image evidence, registry SPDX, registry
provenance, Trivy JSON or OpenAPI. An empty/malformed registry attestation is a
publication failure even when the image is runnable. Do not hand the digest to
deployment until the complete artifact exists and its OpenAPI hash matches.

## Package permission diagnostics

Confirm the workflow has `packages: write`, repository Actions permissions
allow the pinned actions, the login uses `github.actor` with
`secrets.GITHUB_TOKEN`, and an organization policy has not denied GHCR. Do not
change package visibility, billing, repository token defaults or organization
policy from this runbook; those are owner decisions.

## Safe workflow rerun

A rerun is safe only for the same `stage` commit and reviewed workflow. It may
restore missing evidence or confirm the same SHA tag. After completion, compare
the new digest with any digest already recorded for that SHA; divergence is a
stop condition requiring investigation. Never delete evidence or retag a
different image to hide divergence.

Native GitHub artifact attestations for private repositories require Enterprise
Cloud. Lack of that plan feature is expected here; lack of readable BuildKit
registry attestations is not.
