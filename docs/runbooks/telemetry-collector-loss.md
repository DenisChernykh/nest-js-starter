# Потеря telemetry collector

OTel collector не является dependency readiness check. При его недоступности
API продолжает обслуживать запросы, а `SanitizingSpanExporter` и Pino не
должны выводить секреты, cookies или raw session tokens.

Проверьте логи `otel` и восстановите endpoint/сеть на уровне deployment input
`OTEL_EXPORTER_OTLP_ENDPOINT`. После восстановления дождитесь новых trace
exports. Runtime metrics и metric exporter в этом starter не используются.

## Локальная проверка fail-open

В запущенном `pnpm dev` остановите только Alloy, проверьте readiness API и
верните collector:

```sh
docker compose --profile observability stop alloy
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
docker compose --profile observability start alloy
```

Первая команда — намеренная локальная проверка отказа collector. Readiness API
должен остаться здоровым. Новые traces снова поступают в Tempo только после
запуска Alloy; накопление и повторная отправка пропущенных spans не
гарантируются.
