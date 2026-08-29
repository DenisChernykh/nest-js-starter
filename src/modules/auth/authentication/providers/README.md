# Authentication provider boundary

`password/` is the first authentication provider. Email is its lookup identifier; email by itself is not an identity provider.

Every provider follows the same one-way flow:

1. Validate provider-specific proof.
2. Resolve that proof to one stable internal `userId`.
3. Pass the stable `userId` to `SessionIssuer` and return its session result.

Provider proof must never auto-link an account by matching email. A future linking flow must be explicit, authenticated and separately audited.

The provider capability owns provider-specific replay protection, rate limiting and audit events. Shared ports may implement those controls, but the responsibility remains at the provider boundary and runs before session issuance.

A provider must not read or mutate Redis session state, role assignments, account status, session generation or global session epoch. Those checks and writes remain behind `SessionIssuer` and the session/identity boundaries.

This directory intentionally contains no generic registry, adapter skeleton or provider schema. Add each artifact with the first provider that demonstrates its concrete contract.
