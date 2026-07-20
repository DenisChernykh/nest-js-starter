# Redis platform

Responsibility: future capability-based Redis primitives.

Allowed dependencies: platform configuration/lifecycle and the approved Redis
client. The capability is consumed by module infrastructure/composition, never
by application or domain.

Add the first TypeScript file only when the owning slice introduces a real
runtime contract; do not add sample business behavior to populate the folder.
