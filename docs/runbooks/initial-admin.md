# Создание первого администратора

Команда создаёт администратора один раз для уже мигрированной базы данных. Она
подключается только к PostgreSQL: API и Redis запускать не нужно.

## Предварительные условия

1. Установлен Node.js `24.x`, выбранный через `.nvmrc`.
2. Задан `DATABASE_URL`.
3. Выполнен `pnpm start:migrate`.
4. В `auth_security_state` существует служебная строка миграции с `id = 1`.

## Интерактивный запуск

```bash
pnpm auth:create-admin -- --email admin@example.com
```

Терминал покажет `Password:`, отключит echo на время ввода и восстановит режим
TTY после Enter. Пароль нельзя передавать через аргументы или переменные среды.

## Production Compose

На VPS не устанавливаются исходники, `tsx` или development-зависимости. После
успешных миграций и `finalize-roles.sql` запустите скомпилированную one-shot
команду из того же immutable image. Канонический Compose prefix и защищённый
`.env` определены в [production deployment](./deployment.md).

```bash
set -eu
set +x
set -a
. /opt/nest-js-starter/.env
set +a
production_compose=(docker compose --project-name nest-js-starter-production --env-file /opt/nest-js-starter/.env --env-file /opt/nest-js-starter/active-api.env --file /opt/nest-js-starter/docker-compose.production.yml --file /opt/nest-js-starter/docker-compose.production.rollback.yml)
export DATABASE_URL="postgresql://app_runtime:${POSTGRES_RUNTIME_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
"${production_compose[@]}" run --rm --no-deps -e DATABASE_URL migrator \
  node dist/bootstrap/admin/main.js --email admin@example.com
unset DATABASE_URL
```

URL передаётся контейнеру только через environment, а пароль администратора —
через интерактивный stdin. Команда не получает PostgreSQL admin/migrator,
Redis, auth или GHCR credentials.

## Piped stdin

Для автоматизированного защищённого окружения пароль можно передать одной
строкой через stdin:

```bash
secret-provider | pnpm auth:create-admin -- --email admin@example.com
```

Источник секрета должен завершить строку LF или CRLF. Команда принимает не более
1024 байт UTF-8 и очищает принадлежащий ей mutable buffer после хеширования.

## Результаты и остановка

- `Initial administrator created.` и код `0` означают успешный commit.
- `Initial administrator already exists.` и код `1` означают, что bootstrap уже
  был завершён другим или предыдущим процессом. Повторять команду не нужно.
- `Initial administrator creation failed.` и код `1` означают безопасно
  отредактированную ошибку ввода, конфигурации или PostgreSQL. Проверьте миграции
  и доступность базы; секреты и connection URL намеренно не печатаются.

Успешный результат — единственная строка в `stdout`. Конфликт, ошибка и
структурированный security audit записываются в `stderr`, поэтому JSON audit не
смешивается с результатом, который автоматизация читает из `stdout`.

После успеха запустите API с его полной production-конфигурацией и проверьте
обычный `POST /v1/auth/login`. Удалять или сбрасывать bootstrap-флаг вручную
нельзя. Для последующего operator provisioning доступна независимая CLI-команда
`pnpm auth:create-user`; защищённое HTTP account administration и invitations
остаются отдельными opt-in capabilities.
