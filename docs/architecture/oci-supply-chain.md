# OCI contract

The repository owns one non-root Docker runtime image. The API runs
`node dist/bootstrap/api/main.js`; migrations run as a separate one-shot
role. The API never migrates during startup.

The pull-request gate runs the non-Docker repository checks and does not build
the image. The stage publisher is the only workflow job with GHCR write access:
it builds and pushes one SHA-tagged image, captures the action-produced digest,
runs one compact digest smoke test, and scans that immutable digest with Trivy
for High/Critical vulnerabilities.

The smoke test verifies image metadata, non-root execution, runtime file
allowlist, failed migration isolation, successful migration/readiness, the
authentication problem contract and clean SIGTERM shutdown. No custom pin
validator, attestation reader, evidence schema or evidence artifact is part of
the repository contract.
