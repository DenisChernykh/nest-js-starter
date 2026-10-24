# NestJS Backend Starter

Модульная основа backend-приложений на NestJS: PostgreSQL, авторизация и роли, фоновые процессы, API-контракты и наблюдаемость.

## Возможности

- Cookie-сессии, RBAC и единый формат HTTP-ошибок.
- PostgreSQL/Prisma, Redis, миграции и механизмы фоновой обработки.
- OpenAPI, структурированные логи, OpenTelemetry и автоматизированные архитектурные проверки.

## Инженерные акценты

- Проектирование инфраструктурной основы для развития продуктов.
- Разделение бизнес-модулей, платформенных механизмов и внешних адаптеров.
- Управляемый жизненный цикл процессов и воспроизводимость разработки.

## Стек

TypeScript, NestJS, Prisma.

## Навигация по коду

- [src/modules/](src/modules/) — предметные модули.
- [src/](src/) — исходный код.
- [prisma/](prisma/) — схема данных и миграции.
- [test/](test/) — автоматизированные проверки.
- [docs/](docs/) — архитектура и документация.

## Разработка

Инструменты: Node.js 24, pnpm@11.15.1.

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm lint
```

Параметры окружения перечислены в [.env.example](.env.example). Локальные значения задаются вне Git.

## Развёртывание

Контракт развёртывания использует Docker Compose и Caddy: [docker-compose.production.yml](docker-compose.production.yml), [production.env.example](production.env.example) и [руководство оператора](docs/runbooks/deployment.md). В документации описаны подготовка ролей базы данных, миграции, запуск по digest образа, проверка готовности и восстановление.
