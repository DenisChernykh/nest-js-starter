# Authentication provider boundary

Password is the currently implemented authentication method. Email is its
required account identifier and a lifecycle delivery channel; email by itself
is not an authentication provider. A magic link would be a separate
passwordless method.

Every provider follows the same one-way flow:

1. Validate provider-specific proof.
2. Resolve that proof to one stable internal `userId`.
3. Call `SessionIssuer` with only `userId`, `nowMs`, `deviceLabel` and
   `networkFingerprint`, then return its session result.

Provider proof must never auto-link an account by matching email. A future linking flow must be explicit, authenticated and separately audited.

The provider capability owns provider-specific replay protection, rate limiting and audit events. Shared ports may implement those controls, but the responsibility remains at the provider boundary and runs before session issuance.

A provider must not read or mutate Redis session state, role assignments,
account status, session generation or global session epoch. `SessionIssuer`
reloads those authoritative values through the identity/session boundaries
before it creates a Redis session.

This directory intentionally contains no generic registry, adapter skeleton or provider schema. Add each artifact with the first provider that demonstrates its concrete contract.
