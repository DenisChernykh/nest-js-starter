# Shared application

Responsibility: stable application contracts with multiple independent consumers.

Allowed dependencies: shared domain only.

`TransactionPort` is the first intentional shared contract. Application use
cases depend on it without importing NestJS, Prisma, `pg` or platform code;
database composition supplies its implementation.

Keep module-specific contracts local until multiple independent consumers need
the same abstraction.
