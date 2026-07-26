# Потеря coordination Redis

## Определите incident

| Состояние            | Что происходит                                                                                                | Безопасное действие                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Redis unavailable    | Authoritative instance, его сеть, ACL/TLS или процесс недоступны, но persistent data не признаны утраченными. | Восстановить доступ к тому же authoritative persistent instance.                                                                      |
| Redis data loss      | Persistent volume/AOF/backup не содержит часть или все coordination state.                                    | Зафиксировать scope, восстановить согласованный authoritative dataset либо признать logout; users/passwords в PostgreSQL не теряются. |
| Auth-secret exposure | Скомпрометирован или подозрителен один из auth secrets, Redis может быть healthy.                             | Следовать `session-secret-compromise.md`: ротировать весь auth bundle без mixed replicas.                                             |

Не подменяйте эти ветки друг другом: новая Redis instance не устраняет
компрометацию secrets, а ротация secrets не восстанавливает недоступный Redis.

## Симптомы

- `/health/live` остаётся `200`;
- `/health/startup` остаётся `200`, если process ранее завершил startup;
- `/health/ready` становится `503`, check `redis-coordination` — `down`;
- login и cookie-auth endpoints возвращают безопасный
  `DEPENDENCY_UNAVAILABLE` без connection URL/driver details.

Это ожидаемый fail-closed режим. Не отключайте readiness check и не подменяйте
authoritative coordination instance другим Redis без принятого решения о
принудительном logout всех пользователей. Не выполняйте `FLUSHDB`/`FLUSHALL`,
не меняйте `REDIS_KEY_PREFIX` и не меняйте Redis key bytes как recovery action.

## Redis unavailable: проверка и восстановление

1. Проверьте доступность configured coordination endpoint, ACL/TLS и policy
   `noeviction`, не печатая URL с credentials.
2. Проверьте CPU, память, persistent storage, диск/AOF и сетевой путь Redis.
3. Восстановите тот же authoritative persistent instance; не создавайте пустую
   replacement instance и не переключайте API на иной dataset без явного
   решения incident owner.
4. Дождитесь bounded reconnect и `/health/ready` = `200`.
5. Проверьте login и существующую session. При утрате session data пользователи
   войдут заново; durable users/passwords остаются в PostgreSQL.

Если readiness не восстанавливается после исправления зависимости, корректно
перезапустите API instance. Во время shutdown Redis socket может быть разрушен
по deadline; это не означает отмену уже отправленной команды.

## Redis data loss

1. Остановите promotion и определите, какие persistent volume, AOF и backup
   относятся к authoritative instance; не выводите location или credentials в
   incident evidence.
2. Восстановите согласованный persistent dataset на том же authoritative
   instance по процедуре владельца Redis. Проверяйте AOF/volume перед тем, как
   возвращать API traffic.
3. После reconnect дождитесь `/health/ready` = `200`. Sessions, которых нет в
   восстановленном dataset, должны потребовать новый login; не обходите это
   проверкой и не восстанавливайте их ручным изменением keys.
4. Если восстановление невозможно, явно примите global logout как incident
   decision, сообщите пользователям по утверждённому каналу и документируйте
   потерю без user data. PostgreSQL users/passwords остаются authoritative.

## Локальный Redis-loss drill

В изолированном local/test environment временно сделайте coordination Redis
недоступным, не удаляя его persistent data. Подтвердите последовательно:

1. `/health/ready` становится `503`;
2. login и cookie-auth fail closed с `503`/`DEPENDENCY_UNAVAILABLE`, без Redis
   URL, driver details или cookie в выводе;
3. после возобновления того же authoritative persistent instance readiness
   возвращается к `200`.

Для автоматической проверки в этом repository используйте
`test/e2e/health/redis-outage.e2e.spec.ts`; он моделирует эту последовательность
без записи connection URL или cookie в test evidence.
