# Потеря OpenTelemetry collector

## Ожидаемое поведение

- `/health/live`, `/health/startup` и `/health/ready` не проверяют collector;
- startup и request path продолжают работать;
- в stdout появляются безопасные `otel_diagnostic` records;
- exporter работает с настроенными короткими deadline и не выполняет
  бесконечный retry внутри API;
- при `SIGTERM` неуспешный telemetry flush завершает bounded cleanup с exit 1.

Exit 1 в последнем пункте сообщает об утрате telemetry при остановке. Hard
watchdog остаётся последней защитой от non-settling cleanup. Ни deadline, ни
watchdog не означают, что уже отправленный OTLP request был отменён.

## Проверка

1. Проверьте текущие `OTEL_EXPORTER_OTLP_ENDPOINT` либо signal-specific
   endpoints, protocol `http/protobuf`, DNS/TLS и сетевой маршрут. Не печатайте
   URL с credentials.
2. Проверьте collector и его downstream exporter/backpressure отдельно от API.
3. Убедитесь, что `/health/ready` остаётся `200` и latency обычного запроса не
   вырос до HTTP deadline.
4. Найдите `otel_diagnostic`, но не используйте его message как публичный API
   или readiness signal.
5. После восстановления дождитесь следующего periodic metric export и новых
   spans на collector. Перезапуск API для восстановления соединения не нужен.

## Временное отключение

Если принято отдельное эксплуатационное решение потерять telemetry, задайте
`OTEL_SDK_DISABLED=true` и перезапустите process. Это не автоматический fallback:
изменение должно быть явным, отслеживаемым и обратимым. После восстановления
collector верните `false` и проверьте trace/metric ingestion.
