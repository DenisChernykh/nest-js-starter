# Stage image publication

The Stage workflow in .github/workflows/stage-image.yml remains the repository's
immutable image publication path.
Its documented order is:

1. full stage gate;
2. build and publish the non-root image under the commit SHA;
3. capture the immutable GHCR digest;
4. scan that digest with Trivy for High/Critical findings;
5. pull the same digest;
6. run OCI smoke against that exact digest and revision.

The workflow file is byte-identical to the baseline contract. Trusted
same-repository pull requests other than Dependabot can publish after the full
gate; Stage pushes also publish after the same gate. Only the digest produced
by that successful full stage gate, Trivy check, same-digest pull and OCI smoke
is eligible for the production APP_IMAGE.

The image carries the exact org.opencontainers.image.revision label. The
operator compares that value byte-for-byte with SERVICE_REVISION before
starting Compose. Tags are locators, not production identity.

Local pnpm oci:check proves a local image only. It does not prove GHCR access,
VPS readiness, Caddy routing, PostgreSQL/Redis durability or hosted telemetry.
