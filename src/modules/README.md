# Modules

Responsibility: module-local business capabilities.

Allowed dependencies: only each module's documented public API.

Add the first module only for a real business capability; do not add sample
business behavior to populate this folder.

`approval-requests` is the first production-wired maintained vertical
reference. Read it to follow one real capability through domain, application,
infrastructure, presentation and composition, including auth integration,
product-owned roles, module-owned HTTP problems, Prisma persistence and
OpenAPI. Reuse its boundary decisions, not its business model: it is not a
generic CRUD template and products may replace or remove it.
