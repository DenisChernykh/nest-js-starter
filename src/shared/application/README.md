# Shared application

Responsibility: stable application contracts with multiple independent consumers.

Allowed dependencies: shared domain only.

`TransactionPort` lets application use cases depend on atomic execution
without importing NestJS, Prisma, `pg` or platform code; database composition
supplies its implementation.

`ApplicationError<TCode>` is the framework-free base for failures shared with
an outer transport composition boundary. It retains only an internal message,
an optional cause and a stable application-owned code. HTTP status, public
detail and problem type remain outside the application layer.

Keep module-specific contracts local until multiple independent consumers need
the same abstraction.
