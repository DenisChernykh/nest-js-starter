# Безопасность deployment

Этот runbook задаёт минимальный security baseline для каждого deployment
starter. Он не выполняет deployment, не содержит значений secrets и не меняет
runtime-конфигурацию приложения.

## Публичный периметр

1. Привяжите один контролируемый domain к точному `PUBLIC_API_URL` и разрешите
   только ожидаемые origins в `CORS_ORIGINS`. Для production оба значения должны
   использовать HTTPS.
2. TLS завершается на доверенном reverse proxy/load balancer; сертификат,
   hostname и цепочка должны быть действительны. HTTP перенаправляйте на HTTPS,
   не завершая TLS в API process.
3. Передавайте client IP только от явно разрешённых proxy CIDR в
   `TRUST_PROXY_CIDRS`; прямой доступ к API не должен позволять подменить
   forwarded headers.
4. В production установите `API_DOCS_MODE=protected` либо `off`. Для
   `protected` применяйте отдельную authenticated authorization policy и
   проверяйте, что Swagger недоступен анонимному пользователю. Не оставляйте
   docs public.

## Учётные данные и роли

- API запускается от отдельной non-root service identity с минимальными
  правами: только чтение своего image/configuration и сетевой доступ к нужным
  PostgreSQL, Redis и telemetry endpoints.
- Миграции выполняются отдельным одноразовым identity с правами на schema;
  runtime-identity не получает права на migration/DDL.
- Выдавайте отдельные least-privilege credentials для PostgreSQL, Redis и
  deployment control plane. Ограничьте Redis ACL только командами и keyspace,
  нужными coordination-сессиям и login limits.
- Храните credentials и четыре auth secrets только в secret provider. Не
  помещайте их в image, Git, shell history, логи, evidence или support tickets.
  Отзывайте доступ уходящих людей и старые credentials по процедуре владельца.

## Coordination Redis: durability contract

Coordination Redis содержит активные opaque sessions и login-limit state, это
не disposable cache. Его data directory должен находиться на persistent storage,
который переживает replacement container/VM и имеет проверяемое резервное
копирование.

Перед promotion проверьте у владельца Redis configuration:

```text
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

`appendfsync everysec` означает ограниченный, но не нулевой риск потери до
последней секунды записей при аварии; более строгий `always` оценивают отдельно
по latency. Контролируйте доступное место, AOF rewrite и успешное восстановление
из backup. Не меняйте `REDIS_KEY_PREFIX`, Redis key bytes и не выполняйте
automatic `FLUSHDB`/`FLUSHALL` как часть deployment или recovery.

## Перед запуском и после него

1. Проверьте, что domain/TLS, protected Swagger, proxy allowlist и секреты
   настроены, но не выводите их значения.
2. Убедитесь, что все API replicas получают один согласованный configuration
   revision и что Redis использует authoritative persistent storage.
3. После запуска проверьте `/health/live`, `/health/startup` и `/health/ready`;
   readiness допускает traffic только при доступных PostgreSQL и coordination
   Redis.
4. Если security input или Redis durability contract не подтверждён, остановите
   promotion и эскалируйте владельцу infrastructure. Не исправляйте это
   изменением application code или ослаблением readiness.
