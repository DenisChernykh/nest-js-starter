# Потеря coordination Redis

## Симптомы

- `/health/live` остаётся `200`;
- `/health/startup` остаётся `200`, если process ранее завершил startup;
- `/health/ready` становится `503`, check `redis-coordination` — `down`;
- login и cookie-auth endpoints возвращают безопасный
  `AUTH_DEPENDENCY_UNAVAILABLE` без connection URL/driver details.

Это ожидаемый fail-closed режим. Не отключайте readiness check и не подменяйте
authoritative coordination instance другим Redis без принятого решения о
принудительном logout всех пользователей.

## Проверка и восстановление

1. Проверьте доступность exact `REDIS_COORDINATION_URL`, ACL/TLS и отсутствие
   eviction policy для coordination instance. Не печатайте URL с credentials.
2. Проверьте CPU, память, диск/AOF и сетевой путь Redis.
3. Восстановите тот же authoritative instance или согласованно восстановленный
   набор данных.
4. Дождитесь bounded reconnect и `/health/ready` = `200`.
5. Проверьте login и существующую session. При утрате session data пользователи
   войдут заново; durable users/passwords остаются в PostgreSQL.

Если readiness не восстанавливается после исправления зависимости, корректно
перезапустите API instance. Во время shutdown Redis socket может быть разрушен
по deadline; это не означает отмену уже отправленной команды.
