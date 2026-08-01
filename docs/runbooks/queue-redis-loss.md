# Потеря queue Redis

Этот runbook применяется только после того, как продукт явно подключил BullMQ
к отдельному `REDIS_QUEUE_URL`. В starter нет product queue или worker, поэтому
конкретные queue names, payload, readiness и business recovery принадлежат
продукту. Не заменяйте queue Redis на `REDIS_AUTH_URL` и не используйте этот
runbook для auth sessions или login limits: для них есть
[`auth-redis-loss.md`](auth-redis-loss.md).

## Классифицируйте incident

| Состояние               | Что происходит                                                                                                  | Безопасное действие                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Queue Redis unavailable | Authoritative Redis instance, сеть, ACL/TLS или процесс недоступны, но persistent data не признаны утраченными. | Восстановить доступ к тому же queue Redis и оставить workers paused до проверки readiness.                                   |
| Queue Redis data loss   | AOF, volume или backup не содержит часть BullMQ state.                                                          | Зафиксировать scope, восстановить согласованный dataset или запустить product reconciliation из authoritative durable state. |
| Worker failure          | Redis может быть healthy, но worker не обрабатывает jobs или не завершает shutdown.                             | Остановить rollout, восстановить worker runtime и проверить feature readiness до resume.                                     |

BullMQ не является authoritative business history. Наличие healthy `PING` или
очереди не доказывает, что product operation была обработана ровно один раз.

## Detection и immediate containment

1. Зафиксируйте affected product workflow, Redis endpoint class, workers и
   interval incident, не печатая URL, credentials или payload.
2. Проверьте product worker readiness и ограниченные diagnostics, затем Redis
   connectivity, ACL/TLS, memory, disk, AOF и network path.
3. Остановите запуск новых workers и pause feature workers контролируемым
   product-specific способом. Не удаляйте jobs, не выполняйте `FLUSHDB` или
   `FLUSHALL` и не меняйте queue name как recovery action.
4. Если producer не может доказать durable enqueue policy, верните для нового
   work безопасную product-specific failure response или удержите admission.
   Не перенаправляйте jobs в auth Redis и не делайте скрытый in-memory fallback.

## Queue Redis unavailable

1. Восстановите тот же authoritative persistent queue Redis instance с его
   configured persistence и `noeviction` policy. Не создавайте пустую
   replacement instance как незаметную замену.
2. Дождитесь bounded reconnect и product queue readiness. Проверьте, что
   producer и worker используют `REDIS_QUEUE_URL`, а не auth Redis.
3. До resume workers проверьте известный idempotent job или feature-focused
   recovery check. Повторите безопасное выполнение, если Redis сохранил job,
   но worker outcome неизвестен.
4. Возвращайте workers постепенно согласно product concurrency и rate-limit
   policy; затем наблюдайте backlog, failures и bounded diagnostics.

## Queue Redis data loss и AOF/volume recovery

1. Остановите producers и workers для affected workflow. Сохраните evidence о
   времени последнего известного durable business transition и Redis recovery
   point без credentials или payload.
2. Определите authoritative AOF, volume и backup. Восстановите согласованный
   dataset на отдельной проверяемой instance либо на том же authoritative
   instance по процедуре владельца Redis. Не возвращайте workers в traffic до
   проверки AOF/volume и policy `noeviction`.
3. Сверьте BullMQ state с product authoritative durable state. Jobs, которые
   исчезли из Redis, должны быть reconstructed или explicitly failed только
   через product reconciliation; jobs из восстановленного state могут быть
   delivered повторно.
4. После readiness выполните feature-focused recovery test, затем resume
   workers. Убедитесь, что idempotency key и terminal-state checks защищают
   side effects от duplicate delivery.

## Verification before resume

До возврата normal traffic зафиксируйте:

1. queue Redis readiness и worker readiness;
2. отсутствие auth Redis substitution;
3. результат одного controlled idempotent job или approved reconciliation;
4. backlog, failed jobs и known terminal outcomes в product diagnostics;
5. факт, что повторная delivery не создаёт второй durable business effect.

Если эти условия не доказаны, workers остаются paused. После incident обновите
product retry, outbox, idempotency или observability contract, если именно он
не позволил безопасно классифицировать потерю.
