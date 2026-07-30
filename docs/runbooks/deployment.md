# Stage promotion by immutable digest

This runbook promotes one already-published Stage image through the
repository-owned deployment operator. It is policy and procedure, not evidence
that Dokploy or any hosted environment has been called.

Keep an exclusive change window. A concurrent deployment makes the before/after
record comparison ambiguous, so the operator fails closed.

## Human approval gate

Before creating a release manifest, confirm all of the following:

1. The target repository's successful Stage workflow URL identifies the exact
   approved source revision.
2. The workflow published the candidate `image@sha256` and passed its full
   repository gate, Trivy gate and pull-the-same-digest OCI smoke.
3. The OCI `org.opencontainers.image.revision` is expected to equal the
   candidate revision byte-for-byte.
4. The one-shot migrator owns `MIGRATION_DATABASE_URL`; the long-running API
   owns the separate `RUNTIME_DATABASE_URL` and cannot apply schema migrations.
5. The candidate is compatible with the current database schema.
6. The distinct rollback image remains compatible with the schema after the
   candidate migration. Record the human review reference; never plan a
   database down-migration.
7. The complete previous Dokploy environment has been captured in the protected
   operator input described by
   [dokploy-deployment.md](dokploy-deployment.md).

If any item is missing, stop before an apply command. A manifest records an
approval decision; it does not create that approval.

## Release manifest

Start from
[`release-manifest.example.json`](release-manifest.example.json), replace every
symbolic value with evidence from the target repository, and keep the resulting
JSON outside the repository when it represents a real release.

The manifest is deliberately non-secret. It contains:

- environment and repository identity;
- distinct candidate and rollback immutable GHCR references and revisions;
- the successful candidate workflow URL;
- a schema-compatibility review reference for rollback;
- the credential-free public HTTPS API origin.

It must not contain API keys, registry credentials, database or Redis URLs,
cookies, complete runtime environment text or secret values.

## Commands

Run the local validation first:

```sh
pnpm deployment:preflight -- --manifest /protected/path/release.json
```

Review the ordered promotion plan:

```sh
pnpm deployment:promote -- --manifest /protected/path/release.json
```

This second command is an **offline dry-run**. It reads the non-secret manifest
and does not construct Docker, Dokploy, smoke or evidence adapters.

After the human gate and all protected live inputs are ready, the following is
the **only live promotion** command:

```sh
pnpm deployment:promote -- --manifest /protected/path/release.json \
  --apply \
  --evidence /protected/path/promotion-evidence.json
```

The CLI refuses apply without an explicit evidence destination and all live
environment inputs. It refuses to overwrite an existing evidence file.

## Enforced order

The apply command performs this fixed sequence:

1. validate the manifest and protected live inputs;
2. authenticate to private GHCR in an isolated temporary Docker config;
3. pull the exact candidate digest and verify its OCI revision;
4. run the one-shot Prisma migrator from that same image;
5. stop before Dokploy mutation if migration exits non-zero;
6. snapshot existing Dokploy deployments;
7. save the complete candidate runtime environment;
8. save the exact candidate digest as the Docker provider;
9. deploy with a revision-bound title and identify exactly one new record;
10. poll only that record every five seconds, for at most ten minutes;
11. accept only `done`;
12. check `/health/live`, `/health/startup`, `/health/ready` and the
    unauthenticated `/v1/auth/me` RFC 9457 problem;
13. atomically publish redacted evidence with mode `0600`.

The operator host needs network access to GHCR, Dokploy HTTPS, the migration
PostgreSQL endpoint and the public API. Routine deployment does not require SSH
access to the VPS.

## Failed promotion boundary

Image verification or migration failure causes no Dokploy mutation. Once the
environment mutation begins, provider, deploy, identification, polling or
external smoke failure triggers one bounded attempt to restore the protected
previous complete environment. The CLI records whether that restoration was
attempted and succeeded.

The promotion command never invokes a rollback image, never runs a second
migration and never performs an automatic rollback. Preserve the evidence and
make the human rollback-or-roll-forward decision in
[rollback.md](rollback.md). A failed evidence publication is not permission to
repeat a mutation blindly.

Local tests and dry-run output are repository evidence only. A successful
hosted promotion requires the generated evidence file plus independently
reviewed Dokploy and public-runtime observations from that exact execution.
