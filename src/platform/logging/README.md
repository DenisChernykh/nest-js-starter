# Logging platform

Responsibility: direct Pino JSON sink, central redaction and framework logging
adapters. HTTP access and security audit records are added by their owning
follow-up tasks in this slice.

Allowed dependencies: request context and platform configuration.

Production writes newline-delimited JSON to stdout without transports,
prettifiers, body/query/header serialization or automatic HTTP logging.
