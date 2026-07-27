# Компрометация auth secrets

Этот runbook применяется при подозрении на exposure одного или нескольких
auth secrets. При неизвестном scope считайте скомпрометированным весь bundle:
четыре независимых значения `AUTH_SESSION_KEY_SECRET`, `AUTH_CSRF_SECRET`,
`AUTH_RATE_LIMIT_KEY_SECRET` и `AUTH_NETWORK_METADATA_SECRET`.

Это не Redis outage и не Redis data loss. Ротация намеренно инвалидирует
существующие session cookies; Redis не нужно и нельзя автоматически очищать,
а `REDIS_KEY_PREFIX` и Redis key bytes не меняются.

## Сдерживание и подготовка

1. Зафиксируйте время обнаружения и scope в защищённом incident record без
   secret values, cookies, connection URLs или пользовательских данных.
2. Ограничьте доступ к предполагаемому источнику exposure и уведомьте владельца
   security/secret provider. Не публикуйте значения в terminal history, logs,
   chat или evidence.
3. Создайте в secret provider четыре новых, криптографически случайных,
   32-byte values, закодированных canonical unpadded base64url (ровно 43
   символа). Каждое значение должно отличаться от остальных и от всех прежних;
   не копируйте sample values из `.env.example`.
4. Подготовьте единый configuration revision со всеми четырьмя новыми
   значениями. Не применяйте значения по одному и не допускайте replica со
   старым bundle рядом с replica с новым.

## Координированная ротация

1. Переведите deployment в controlled maintenance: снимите API replicas с
   traffic и дождитесь их остановки. Это исключает mixed old/new auth bundle.
2. Атомарно замените весь bundle в secret provider/configuration revision и
   предоставьте его всем будущим replicas.
3. Запустите API replicas только с этим revision и дождитесь
   `/health/ready` = `200`. Не возвращайте traffic, пока не подтверждено, что
   ни одна старая replica не обслуживает запросы.
4. Проверьте restricted audit trail: кто выполнил ротацию, revision и время,
   без значений secrets. Отзовите старый bundle в соответствии с политикой
   secret provider после проверки rollback/incident procedure.

После смены `AUTH_SESSION_KEY_SECRET` прежняя opaque cookie больше не проходит
проверку и должна вернуть `401`. Это ожидаемая глобальная invalidation session,
а не причина восстанавливать старое значение, очищать Redis или менять prefix.

## Локальный drill

В изолированном local/test environment, не использующем production secrets:

1. Создайте valid session обычным login и сохраните cookie только внутри
   браузерного/API-client cookie jar; не копируйте её в terminal, файл или
   evidence.
2. Выполните coordinated rotation всех четырёх тестовых secrets по процедуре
   выше: остановите все local API replicas, замените единый bundle, запустите
   их снова и дождитесь readiness `200`.
3. Тем же cookie jar запросите protected endpoint и зафиксируйте только status
   `401` для старой session.
4. Выполните новый login, запросите protected endpoint и зафиксируйте успешную
   новую session. Не записывайте cookie, secret или URL.

Если readiness не возвращается, следуйте runbook потери coordination Redis.
Не откатывайте secret rotation частично и не смешивайте revisions ради
кратковременного сохранения старых sessions.
