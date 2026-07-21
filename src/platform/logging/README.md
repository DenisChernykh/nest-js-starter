# Logging platform

Responsibility: direct Pino JSON sink, central redaction, framework logging
adapters, one final HTTP access record and finite security audit records.

Allowed dependencies: request context and platform configuration.

Production writes newline-delimited JSON to stdout without transports,
prettifiers, body/query/header serialization or automatic HTTP logging.
