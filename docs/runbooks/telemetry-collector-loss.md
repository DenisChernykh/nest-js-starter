# Потеря telemetry collector

OTel collector не является dependency readiness check. При его недоступности
API продолжает обслуживать запросы, а `SanitizingSpanExporter` и Pino не
должны выводить секреты, cookies или raw session tokens.

Проверьте логи `otel` и восстановите endpoint/сеть на уровне deployment input
`OTEL_EXPORTER_OTLP_ENDPOINT`. После восстановления дождитесь новых trace
exports. Runtime metrics и metric exporter в этом starter не используются.
