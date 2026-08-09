# Reference approval requests module design

## Статус

Согласовано 2026-07-28. Документ описывает дизайн первого небольшого
бизнес-модуля, который остаётся подключённым к основному API стартера и служит
исполняемым ориентиром для следующих продуктовых модулей.

## Цель

Добавить один полностью рабочий вертикальный slice, который доказывает, что
стартер расширяется без нарушения локальных hexagonal boundaries:

1. новый модуль получает авторизованного principal через публичный auth-контракт;
2. модуль объявляет собственные permissions;
3. application и domain остаются независимыми от NestJS и Prisma;
4. PostgreSQL сохраняет агрегат и атомарно применяет бизнес-переход;
5. модульные ошибки становятся безопасными RFC 9457 Problem Details;
6. OpenAPI, unit, integration, e2e и architecture gates проверяют один и тот же
   контракт.

Модуль называется `approval-requests` и импортируется основным `ApiModule`.
Его endpoints, Prisma-модель и миграция являются частью запускаемого
приложения, а не неисполняемым примером в `examples/`.

## Почему модуль остаётся в основном приложении

Nest-модуль работает только после подключения к composition root. Отдельный
каталог с исходниками не проверил бы реальную DI-композицию, глобальные guards,
Prisma migration, OpenAPI generation или HTTP error filter.

Альтернатива с отдельным reference-приложением потребовала бы второго
bootstrap, отдельной конфигурации и отдельного Prisma-клиента. Это создало бы
второй стартер внутри репозитория и затруднило синхронизацию.

`approval-requests` поэтому является небольшим reference business module:

- он полностью работает в стандартном API process;
- имеет реальные security и persistence contracts;
- изолирован одной модульной директорией;
- показывает расширение стартера на коде, который компилируется и тестируется;
- не вводит универсальные repository/controller/service abstractions.

Документация foundation и roadmap должны явно отличать универсальное ядро от
этого reference business slice.

## Не входит в scope

- регистрация и административное создание пользователей;
- список запросов и пагинация;
- комментарии к решению;
- вложения;
- уведомления и email;
- очереди, фоновые worker processes и Redis;
- повторное открытие или удаление запроса;
- универсальный workflow engine;
- генератор модулей, manifest или overlay-механизм;
- отдельный audit/event store.

Кто и когда принял решение, хранится в самом агрегате. Двух пользователей для
integration/e2e создают тестовые DB fixtures; production user provisioning
остаётся задачей конкретного продукта.

## Архитектурная граница

Модуль располагается в:

```text
src/modules/approval-requests/
├── domain/
├── application/
├── infrastructure/
├── presentation/
├── composition/
└── index.ts
```

Направления зависимостей остаются такими же, как в
`docs/architecture/module-boundaries.md`:

- domain не импортирует framework, Prisma, platform или auth;
- application использует собственный domain и стабильные shared contracts;
- infrastructure реализует application ports через Prisma;
- presentation переводит HTTP input в команды application;
- composition связывает controller, use cases, ports и adapters;
- bootstrap импортирует только composition API модуля.

Application use cases получают `actorUserId` как входное значение и не знают,
как была установлена пользовательская сессия.

## Happy path

1. Авторизованный пользователь отправляет `POST /v1/approval-requests`.
2. Presentation получает текущий `AuthenticatedPrincipal` через публичный
   auth integration contract.
3. `CreateApprovalRequestUseCase` создаёт агрегат со статусом `pending`.
4. Другой пользователь с `approval.requests.decide` отправляет решение.
5. `DecideApprovalRequestUseCase` запрещает self-decision и проверяет текущее
   состояние.
6. Repository атомарно переводит `pending` в `approved` или `rejected` и
   возвращает актуальное представление.

Основной путь:

```text
HTTP
→ auth/RBAC
→ approval presentation
→ approval application
→ approval domain
→ approval repository
→ PostgreSQL
```

## Бизнес-модель

Единственный агрегат — `ApprovalRequest`.

| Поле              | Тип                                  | Правило                                   |
| ----------------- | ------------------------------------ | ----------------------------------------- |
| `id`              | UUID                                 | Генерируется при создании                 |
| `title`           | string                               | От 1 до 120 символов после нормализации   |
| `description`     | string                               | От 1 до 2 000 символов после нормализации |
| `status`          | `pending`, `approved` или `rejected` | Изначально только `pending`               |
| `createdByUserId` | UUID                                 | Автор запроса                             |
| `decidedByUserId` | UUID или null                        | Отсутствует до решения                    |
| `createdAt`       | timestamp                            | Устанавливается при создании              |
| `decidedAt`       | timestamp или null                   | Устанавливается одновременно с решением   |

Для `title` и `description` нормализация означает удаление только начальных и
конечных пробельных символов. Внутренние пробелы сохраняются, а ограничения
длины применяются после `trim`.

Разрешены только два перехода:

```text
pending → approved
pending → rejected
```

`approved` и `rejected` являются terminal states. Повторное решение, удаление и
возврат в `pending` запрещены.

Prisma schema добавляет отдельный enum и модель. `createdByUserId` и
`decidedByUserId` ссылаются на `User` с `onDelete: Restrict`, чтобы удаление
учётной записи не уничтожало историю решения. Изменение оформляется новой
migration после существующего baseline; baseline не переписывается.

## HTTP API

### Создание

```http
POST /v1/approval-requests
Content-Type: application/json
```

```json
{
  "title": "Publish July price list",
  "description": "Approve the price list before publication."
}
```

Успех: `201 Created` и полное публичное представление pending-запроса.
Операция доступна любому авторизованному пользователю.

Публичное представление содержит только `id`, `title`, `description`, `status`,
`createdByUserId`, `decidedByUserId`, `createdAt` и `decidedAt`.

### Чтение

```http
GET /v1/approval-requests/{requestId}
```

Успех: `200 OK`. Читать может автор либо principal с
`approval.requests.read`. Для остальных запрос считается недоступным и
возвращается как `APPROVAL_REQUEST_NOT_FOUND`, чтобы не раскрывать его
существование.

### Решение

```http
PUT /v1/approval-requests/{requestId}/decision
Content-Type: application/json
```

```json
{
  "decision": "approved"
}
```

Допустимы только `approved` и `rejected`. Успех: `200 OK` и актуальное
представление terminal-запроса.

Endpoint требует `approval.requests.decide`. Повторный HTTP-запрос не меняет
уже принятое решение и получает conflict problem.

## Auth и RBAC integration contract

`approval-requests/application` не импортирует auth. Presentation передаёт в
use case только `principal.userId`.

Auth предоставляет узкий документированный integration surface для
бизнес-контроллеров:

- безопасное чтение текущего `AuthenticatedPrincipal`;
- декларацию требуемых `PermissionKey`;
- отсутствие доступа к raw cookie, session token, Redis record или
  `AuthRequestContext` internals.

Точный Nest adapter остаётся в auth presentation, но доступ к нему идёт только
через публичный API auth-модуля. Deep imports вида
`@/modules/auth/presentation/*` из `approval-requests` запрещены.

`approval-requests` объявляет, но не назначает permissions:

```text
approval.requests.read
approval.requests.decide
```

Полный role registry собирается product composition root:

```text
system.admin
├── system.docs.read
├── approval.requests.read
└── approval.requests.decide

approval.reviewer
├── approval.requests.read
└── approval.requests.decide
```

Auth отвечает на вопрос, разрешён ли principal данный класс операций.
Approval application отдельно проверяет object-level policy и бизнес-инвариант
о запрете self-decision.

## Ошибки application

Framework-free ошибки модуля имеют конечный union кодов:

```text
APPROVAL_REQUEST_NOT_FOUND
APPROVAL_REQUEST_ALREADY_DECIDED
APPROVAL_SELF_DECISION_FORBIDDEN
```

Shared application может содержать только минимальный типизированный
`ApplicationError<TCode>`, потому что после появления `approval-requests` у
контракта есть два независимых потребителя: auth и approval. Базовый error:

- хранит стабильный application code;
- не хранит HTTP status или RFC 9457 type;
- не объявляет exception message публичным;
- не используется как generic service или глобальная бизнес-иерархия.

Auth errors переводятся на этот контракт без изменения существующих публичных
auth outcomes.

## Модульные Problem Details

Platform HTTP предоставляет общий immutable registry/filter mechanism, но не
импортирует auth или approval.

Каждый business module владеет своим HTTP problem contribution:

- конечными публичными definitions;
- отображением собственных application errors;
- разрешёнными безопасными extensions, если они нужны.

API composition root собирает:

```text
core HTTP problems
+ auth problem contribution
+ approval-requests problem contribution
→ one API problem registry
```

`HttpErrorsModule` регистрируется в корневой API-композиции один раз. Дубликат
`code`, `slug` или `type` является startup configuration error. Неизвестная
application error не получает автоматический публичный code: она безопасно
становится `INTERNAL_ERROR` и логируется как unexpected.

Наличие произвольного строкового свойства `.code` не делает исключение
известным. Module mapper принимает только явно поддерживаемые типы application
errors, поэтому коды Prisma, Node.js и сторонних библиотек не могут случайно
стать публичными.

Approval mapping:

| Условие                                  | Публичный code                     | HTTP |
| ---------------------------------------- | ---------------------------------- | ---: |
| Запрос отсутствует или скрыт read policy | `APPROVAL_REQUEST_NOT_FOUND`       |  404 |
| Terminal state уже содержит решение      | `APPROVAL_REQUEST_ALREADY_DECIDED` |  409 |
| Автор пытается решить собственный запрос | `APPROVAL_SELF_DECISION_FORBIDDEN` |  403 |

Остальные отказы используют core/auth problems:

| Условие                        | Публичный code            |
| ------------------------------ | ------------------------- |
| Невалидное тело                | `VALIDATION_FAILED`       |
| Нет обязательной сессии        | `AUTHENTICATION_REQUIRED` |
| Нет endpoint permission        | `AUTHORIZATION_DENIED`    |
| PostgreSQL временно недоступен | `DEPENDENCY_UNAVAILABLE`  |
| Неизвестная ошибка             | `INTERNAL_ERROR`          |

Filter строит `type`, `title`, `status`, `detail`, `code`, `instance` и
`requestId` только из зарегистрированных констант. `error.message`, stack,
Prisma messages и rejected input в response не попадают.

Пример conflict:

```json
{
  "type": "https://nest-js-starter.invalid/problems/approval-request-already-decided",
  "title": "Approval request already decided",
  "status": 409,
  "detail": "A decision has already been recorded for this request.",
  "code": "APPROVAL_REQUEST_ALREADY_DECIDED",
  "instance": "urn:request:019...",
  "requestId": "019..."
}
```

Frontend ветвится по `code`, а не по `detail`.

## OpenAPI contract

Runtime filter, Swagger document и `docs/api/problem-types.md` используют один
собранный каталог definitions. Добавление module problem без OpenAPI enum и
committed documentation должно ломать conformance gate.

Новые операции имеют стабильные `operationId`, request/response DTOs и явные
`ApiProblemResponses`. `docs/api/openapi.json` обновляется только явной
authoring-командой после review новых wire contracts.

## Repository port и конкурентность

Application-owned repository port предоставляет три намеренные операции:

```text
create
findById
decidePending
```

Он не является generic CRUD repository.

Repository возвращает сохранённое состояние, а решение о доступности принимает
application use case. Persistence adapter не получает permissions и не владеет
object-level authorization policy.

`decidePending` применяет compare-and-set по `id` и `status = pending`. Если два
reviewer одновременно принимают решение:

1. только одна транзакция изменяет строку;
2. результат первой транзакции остаётся неизменным;
3. проигравшая операция перечитывает минимальное состояние и возвращает
   `APPROVAL_REQUEST_ALREADY_DECIDED`.

Отдельное поле `version` не добавляется: для единственного разрешённого
перехода условие по terminal status является достаточным concurrency token.

Repository и use case обязаны различать:

- неизвестный/скрытый id;
- self-decision;
- существующий terminal state;
- временную недоступность PostgreSQL.

Различение выполняется без утечки persistence messages в HTTP.

Для команды решения применяется порядок: загрузить запрос, проверить
terminal state, затем проверить self-decision и выполнить compare-and-set.
Проигравший конкурентный compare-and-set перечитывает состояние и возвращает
already-decided conflict.

## Проверка

### Unit

- создание нормализованного pending aggregate;
- оба допустимых terminal transitions;
- запрет self-decision;
- запрет повторного решения;
- object-level read policy;
- точные application error codes;
- полный модульный error mapping;
- отказ problem registry на дубликатах;
- безопасный fallback неизвестной ошибки.

### Integration с PostgreSQL

- Prisma mapping всех полей;
- создание и чтение автором/reviewer;
- атомарный `decidePending`;
- два конкурентных решения дают один success и один conflict;
- правильное различение not found и already decided;
- dependency failure не выдаёт Prisma detail.

### E2E

- unauthenticated create получает `AUTHENTICATION_REQUIRED`;
- автор создаёт и читает запрос;
- посторонний principal получает `APPROVAL_REQUEST_NOT_FOUND`;
- principal без decide permission получает `AUTHORIZATION_DENIED`;
- автор с decide permission получает
  `APPROVAL_SELF_DECISION_FORBIDDEN`;
- reviewer принимает решение;
- повторное решение получает `APPROVAL_REQUEST_ALREADY_DECIDED`;
- каждый problem имеет `application/problem+json`, `requestId` и безопасные
  константные поля;
- OpenAPI содержит три операции и полный problem code enum.

### Gates

- narrow unit tests во время разработки;
- repository integration tests с реальным PostgreSQL;
- новые e2e scenarios;
- `pnpm architecture:check`;
- OpenAPI drift/lint/conformance;
- `pnpm check:quick` перед завершением slice;
- `pnpm check` перед публикацией PR, если окружение предоставляет Docker.

Локальные gates, удалённый CI и runtime/deployment evidence сообщаются как
разные статусы.

## Документация

В том же implementation slice обновляются:

- `docs/architecture/module-boundaries.md` — публичный auth integration и
  module problem contributions;
- `docs/architecture/errors-logging-observability.md` — сборка problem
  registry;
- `docs/architecture/foundation-scope.md` — различие foundation и reference
  business module;
- `docs/architecture/openapi-contracts.md` — модульные problem definitions;
- `docs/api/problem-types.md` и `docs/api/openapi.json`;
- `docs/roadmap.md` — новый подтверждённый reference slice;
- `src/modules/README.md` — назначение первого business module.

## Acceptance criteria

Slice завершён только когда:

1. `ApprovalRequestsModule` импортирован основным `ApiModule`;
2. migration с `ApprovalRequest` применяется с пустой базы после baseline;
3. три HTTP операции работают с общей cookie auth и CSRF policy;
4. роли собираются composition root без product permissions внутри auth;
5. approval application не импортирует NestJS, Prisma, platform или auth;
6. platform не импортирует business modules и не содержит approval-specific
   conditions;
7. frontend получает три стабильных approval problem codes;
8. конкурентное решение доказано integration test;
9. committed OpenAPI и problem documentation синхронизированы с runtime;
10. релевантные локальные gates имеют свежий фактический результат.
