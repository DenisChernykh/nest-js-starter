# Capability catalog

## Назначение и границы

Этот каталог фиксирует пространство существующих и возможных capabilities
`nest-js-starter`: что уже доступно, что можно добавить, какие реальные
сценарии это оправдывают и от каких контрактов зависит внедрение.

Рабочая модель starter:

- проект копирует весь работающий starter;
- лишние capabilities удаляются или адаптируются с помощью AI-агента;
- неизвестные будущие потребности не требуют преждевременного удаления;
- generator, manifest, recipe engine и сложный removal lifecycle сейчас не
  нужны.

Каталог не является backlog, implementation plan или разрешением реализовать
всё перечисленное. [`docs/roadmap.md`](roadmap.md) отвечает за выбранную
последовательность реализации. Architecture-документы и runbooks описывают
контракты уже реализованных capabilities.

Фактическое состояние существующих capabilities сверено с `stage` на коммите
`c88dcf5` от 2026-08-08. При расхождении каталога с кодом источником истины
остаётся код; каталог обновляется вместе с изменившей capability.

## Форматы capability

- **Core** — bundled baseline runtime или operations contract, который нужен
  почти любому проекту. Runtime-часть обычно входит в default composition;
  deployment/recovery procedures применяются явно в соответствующем окружении.
- **Kit** — переиспользуемый технический набор механизмов. Он остаётся inert до
  явного подключения в composition root и не владеет продуктовым API или
  business policy.
- **Reference** — поддерживаемая вертикаль с реальным бизнес-сценарием. Её
  копируют, адаптируют или удаляют целиком, не превращая в generic CRUD.
- **Product-specific** — capability, чьи данные и policy пока доказаны только
  одним продуктом. Общая часть извлекается после подтверждённого повторения.

Одна capability может состоять из нескольких форм: например, технического Kit
и provider-specific Reference поверх него. В карточке такая граница указывается
явно. Runtime activation не определяет форму: Core operations contract не обязан
быть постоянно запущенным process, Kit может быть inert до явной composition, а
Reference — default-disabled или production-wired.

Не каждая запись каталога является новой application capability. Поле
**Entry kind** отличает четыре сущности:

- **Capability** — копируемый runtime или operations contract;
- **Certification** — proof существующей foundation;
- **Repository maintenance** — сопровождение исходного repository и его
  contracts;
- **Environment evidence** — результат проверки конкретного host, revision или
  recovery target.

Для трёх последних видов поле **Form** может быть `Not applicable`; рядом
указывается, какой Core, Kit или Reference они проверяют или сопровождают.

## Статусы каталога

- **Available** — capability присутствует в текущем starter и имеет
  документированный контракт использования.
- **Partial** — отдельные prerequisites или механизмы уже есть, но полный
  пользовательский контракт отсутствует.
- **Validated candidate** — назван реальный consumer и понятен failure model;
  реализация всё ещё требует отдельного решения.
- **Exploratory** — направление стоит помнить, но consumer или failure model
  ещё недостаточно определены.
- **Deferred** — известна конкретная причина не реализовывать capability сейчас.
- **Rejected** — направление рассмотрено и сознательно исключено из
  поддерживаемой модели.
- **Not recorded** — environment evidence для выбранного host/revision ещё не
  получено; это не означает отсутствия repository capability.

Статуса `Planned` здесь нет: выбранное планирование принадлежит roadmap.

## Приоритет

- **P0** — production-риск или пробел в обязательной foundation.
- **P1** — высокий reuse и подтверждённый consumer.
- **P2** — полезно после появления соответствующего продукта или provider.
- **P3** — исследовательское направление.

Приоритет помогает выбрать следующее обсуждение, но не задаёт порядок PR.
Для `Rejected` entry приоритет может быть `—`: такая запись не находится в
очереди реализации.

## Связи между capabilities

Каждая детально рассмотренная карточка использует четыре поля:

- **Required dependencies** — без чего capability нельзя реализовать корректно.
- **Conditional dependencies** — что требуется только при определённом failure
  contract или topology.
- **Blocked by** — отсутствующий prerequisite или evidence gate, реально
  запрещающий начинать работу.
- **Unlocks** — какие следующие capabilities становятся проще или возможны.

Наличие связи не означает обязательного объединения в один модуль или PR.
Зависимая capability должна оставаться самостоятельно удаляемой.

## Текущее содержимое starter

| Capability                                                                                                                   | Статус    | Формат    | Граница                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | --------- | --------- | --------------------------------------------------------------------------------------------- |
| Config, lifecycle, HTTP, PostgreSQL, auth Redis, auth/RBAC, RFC 9457, logging, trace-only OpenTelemetry, OpenAPI и OCI gates | Available | Core      | Обязательная production foundation                                                            |
| Self-service registration, mailbox verification и password recovery                                                          | Available | Reference | Default-disabled auth vertical; не identity proofing и не notification platform               |
| Account administration, disablement и retirement                                                                             | Available | Reference | Default-disabled operator vertical; retirement не равен privacy erasure                       |
| Account invitations и administrator-triggered recovery                                                                       | Available | Reference | Отдельный default-disabled auth vertical; требует включённого account administration          |
| BullMQ connection, readiness и worker lifecycle                                                                              | Available | Kit       | Нет product queue, payload, processor или worker executable                                   |
| Transactional PostgreSQL outbox и BullMQ relay                                                                               | Available | Kit       | Нет product event catalog, consumer или exactly-once гарантии                                 |
| Bounded non-overlapping periodic maintenance runner                                                                          | Available | Kit       | Process-local lifecycle; нет durable schedule, retries или distributed lock                   |
| `INT-01` bounded native-fetch attempt и classifier-owned retry runner                                                        | Available | Kit       | Нет provider/status/idempotency или durable policy                                            |
| Production Compose, Caddy handoff, rollback и database-role preparation                                                      | Available | Core      | Ручной operations path; hosted environment остаётся внешним                                   |
| PostgreSQL backup и isolated restore procedure                                                                               | Available | Core      | Repository владеет безопасным operations contract; его исполнение environment-owned           |
| `approval-requests`                                                                                                          | Available | Reference | Production-wired вертикаль, а не generic CRUD; удаление затрагивает root composition и Prisma |

Основные реализованные контракты описаны в
[`foundation-scope.md`](architecture/foundation-scope.md),
[`durable-jobs.md`](architecture/durable-jobs.md),
[`transactional-outbox-adoption.md`](architecture/transactional-outbox-adoption.md),
[`periodic-maintenance.md`](architecture/periodic-maintenance.md),
[`bounded-outbound-http.md`](architecture/bounded-outbound-http.md)
и [`src/modules/README.md`](../src/modules/README.md).

## Карта категорий

Подробный разбор завершён для всех 12 категорий. Строки фиксируют карту
capabilities и их границы, а не готовый backlog: каждая детальная карточка ниже
может быть выбрана в roadmap только отдельным решением.

| №   | Категория                                | Примеры capabilities                                                                                     | Типичная форма                   | Состояние разбора |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------- |
| 1   | Production foundation                    | Config, lifecycle, PostgreSQL, HTTP, errors, OpenAPI, observability, CI, OCI, deployment, backup/restore | Core + Kit                       | Разобрано         |
| 2   | Human authentication и account assurance | Password auth, sessions, recovery, passkeys, MFA, OIDC, account linking                                  | Core + factor/provider Reference | Разобрано         |
| 3   | Organizations и machine access           | Organizations, memberships, tenant roles, API keys, service accounts, scopes, rotation                   | Reference                        | Разобрано         |
| 4   | Надёжность и фоновые процессы            | BullMQ, outbox, periodic runners, idempotency, receipts, leases, retry/redrive                           | Kit                              | Разобрано         |
| 5   | Интеграции и синхронизация               | External HTTP, inbound/outbound webhooks, reconciliation, import/export, connector sync                  | Kit + Reference                  | Разобрано         |
| 6   | Коммуникации                             | Email, SMS, push, templates, attempts, preferences, in-app inbox, digests                                | Consumer-first Kit/Reference     | Разобрано         |
| 7   | Данные, файлы и discovery                | Profiles, uploads, media, documents, storage, catalog, indexing, search                                  | Product-specific + adapters      | Разобрано         |
| 8   | Operations, governance и privacy         | Business audit, change history, support actions, consent, export/erasure, retention                      | Reference + product policy       | Разобрано         |
| 9   | Human workflow и collaboration           | Approval, moderation, intake, tickets, assignment, comments, mentions                                    | Reference или Product-specific   | Разобрано         |
| 10  | Commerce, entitlements и allocation      | Orders, payments, refunds, subscriptions, quotas, promotions, booking, holds                             | Product-specific verticals       | Разобрано         |
| 11  | Analytics и reporting                    | Projections, usage accounting, operator/customer reports, exports                                        | Product-specific                 | Разобрано         |
| 12  | AI и automation                          | Extraction, classification, generation, RAG, agent actions, evaluations, budgets                         | Experimental Product-specific    | Разобрано         |

## Стандартная карточка

При разборе остальных категорий используется один формат:

```md
### `<ID>`. `<Название>`

- **Entry kind:** `Capability | Certification | Repository maintenance | Environment evidence`
- **Catalog status:**
- **What already exists:**
- **What could be added:**
- **Named consumer:**
- **Failure model:**
- **Form:** `Core | Kit | Reference | Product-specific | Not applicable`
- **Required dependencies:** dependency +
  `Available | Missing | Product-owned | Repository-owned | Environment-owned`
- **Conditional dependencies:** dependency + условие
- **Blocked by:**
- **Unlocks:**
- **Priority:**
- **Reasons to defer / non-goals:**
- **Evidence:**
```

## 1. Production foundation

### Уже доступная foundation

- Runtime Core предоставляет pre-Nest environment validation, immutable typed
  config, безопасные HTTP limits/timeouts, lifecycle phases, traffic admission,
  health endpoints и bounded graceful shutdown.
- PostgreSQL Core предоставляет один owned Pool/Prisma client, readiness,
  module-local transaction boundary, отдельный migrator process и разные
  production roles для administration, migrations и runtime.
- HTTP Core предоставляет Helmet, exact-origin CORS, trusted-proxy policy,
  strict request validation, RFC 9457 application errors и committed OpenAPI с
  drift/lint gates.
- Logging и observability Core предоставляют Pino, request/trace correlation,
  safe error serialization и trace-only OpenTelemetry. Локальные
  Alloy/Loki/Tempo/Grafana остаются operations composition, а не runtime
  dependency API.
- Repository и OCI gates предоставляют formatting, Prisma validation,
  typecheck, tests, dependency boundaries, compiled build, non-root image,
  immutable digest smoke и Trivy High/Critical scan.
- Operations path предоставляет local Compose, migration-first production
  Compose, host-owned Caddy handoff, database-role preparation и
  schema-compatible API-only rollback.
- PostgreSQL backup/restore уже описан как Core operations contract, но
  scheduler, off-host storage, alerts и выполненный restore drill не принадлежат
  runtime starter.

В этой категории не найден доказанный пробел, требующий нового runtime-модуля.
Следующие карточки разделяют repository-owned portability, environment evidence
и направления, которые становятся оправданными только после конкретного
production trigger.

### `PF-01`. Git-free clean-copy certification

- **Entry kind:** Certification.
- **Catalog status:** Partial.
- **What already exists:** exact Node/pnpm contracts, package gates, local и
  production Compose, migrations, initial-admin bootstrap и OCI smoke доступны;
  Git-free certification run не зафиксирован. Текущий `pnpm check` не является
  Git-free: deployment-docs unit suite вызывает `git grep` и читает historical
  workflow через `git show`.
- **What could be added:** сначала заменить Git-bound test assertions на
  repository-file/semantic checks без historical commit dependency; затем
  добавить customization checklist и один воспроизводимый smoke полного проекта,
  скопированного без `.git`, dependencies, generated output и local environment
  files.
- **Named consumer:** основной distribution flow самого starter — следующий
  проект, созданный копированием всего работающего repository.
- **Failure model:** скрытая зависимость от Git history, sibling repository,
  local cache или generated artifact; после копирования остаются неверные
  service identity, origins, secrets, database/Redis URLs, image coordinates
  либо initial-admin procedure.
- **Form:** Not applicable; проверяет переносимость Core.
- **Required dependencies:** existing package gates, Node 24, pnpm 11.15.1,
  Docker/Compose, migrations и OCI smoke — Available; Git-independent
  deployment-docs assertions — Missing.
- **Conditional dependencies:** один небольшой orchestration script, только
  если ручной smoke докажет повторяемую ошибкоопасность.
- **Blocked by:** `test/unit/ops/compose-vps-deployment-docs-contract.spec.ts`
  использует `git grep` и `git show 608410a:...`; после устранения зависимости
  нужны реальный Git-free run и документационный audit. Внешней platform
  dependency нет.
- **Unlocks:** доказанную переносимость всей Core foundation и более надёжное
  применение остальных capabilities в новых проектах.
- **Priority:** P0; это проверка основного обещания starter, а не production
  outage в уже развёрнутом приложении.
- **Reasons to defer / non-goals:** не возвращать generator, manifest, recipe
  engine, golden repository, doctor framework или отдельный certification
  engine; не дублировать существующие gates.
- **Evidence:** pending
  [Milestone 8](roadmap.md#milestone-8-clean-copy-certification) и текущие
  Git-bound assertions в
  [`compose-vps-deployment-docs-contract.spec.ts`](../test/unit/ops/compose-vps-deployment-docs-contract.spec.ts).

### `PF-02`. Hosted deployment and API rollback drill

- **Entry kind:** Environment evidence.
- **Catalog status:** Not recorded.
- **What already exists:** immutable-image preflight, production Compose,
  separate PostgreSQL roles, migration-first startup, external Caddy handoff,
  persistent volumes и API-only rollback документированы и локально проверяемы.
- **What could be added:** evidence с конкретного host для HTTPS/Caddy routing,
  trusted proxy, persistent restart, migration/role contract, compatible
  rollback и Loki-to-Tempo correlation.
- **Named consumer:** первый выбранный production deployment копии starter;
  ближайший известный adoption scenario — Amazing EKB backend.
- **Failure model:** image проходит локальные gates, но реальное окружение
  ломается на DNS/TLS, external networks, secrets, proxy CIDRs, volumes или
  schema-incompatible rollback; telemetry фактически не коррелируется.
- **Form:** Not applicable; проверяет Available production operations Core.
- **Required dependencies:** опубликованный immutable image digest с совпадающей
  revision, production-like host, Caddy/DNS/TLS, protected secrets и текущие
  deployment runbooks — Environment-owned.
- **Conditional dependencies:** hosted Loki/Tempo для telemetry drill; `PF-03`,
  если заявляется доказанная data recovery, а не только application rollout.
- **Blocked by:** выбранное окружение и отдельная авторизация на его изменение.
- **Unlocks:** честное production-readiness evidence конкретного deployment.
- **Priority:** P0 перед production-readiness claim, но не текущий starter
  implementation item.
- **Reasons to defer / non-goals:** не добавлять deploy operator, hosted
  deployment-platform abstraction, GitHub auto-deploy или автоматическое
  решение о rollback.
- **Evidence:** repository/environment boundary в
  [Milestone 7](roadmap.md#milestone-7-composecaddy-deployment-and-recovery-contract).

### `PF-03`. Executed off-host PostgreSQL backup and isolated restore

- **Entry kind:** Environment evidence.
- **Catalog status:** Not recorded.
- **What already exists:** безопасный repository-owned backup/restore Core
  operations contract задаёт environment-owned complete archive/checksum pair,
  off-host retention, isolated target, role preparation и runtime DDL-denial
  verification.
- **What could be added:** один записанный off-host backup и isolated restore
  result; для постоянной эксплуатации — отдельно scheduler, alerting и
  периодический drill в выбранном environment.
- **Named consumer:** PostgreSQL Amazing EKB при его production deployment как
  ближайший известный scenario; тот же evidence обязателен для каждой копии
  starter с authoritative product state.
- **Failure model:** backup не запускается или падает молча; incomplete pair
  считается опубликованной; архив повреждён; restore не воспроизводит migration
  и role contracts либо по ошибке затрагивает source database.
- **Form:** Not applicable; проверяет Available backup/restore Core operations
  contract.
- **Required dependencies:** production PostgreSQL role contract — Available;
  backup/restore и checksum tooling, protected credentials, off-host target и
  isolated restore cluster — Environment-owned.
- **Conditional dependencies:** scheduler и alert destination для ongoing backup
  operations; retention, encryption и region policy — Product-owned при
  соответствующих regulatory требованиях.
- **Blocked by:** выбранное production environment и безопасное место для
  isolated drill.
- **Unlocks:** отдельный data-recovery readiness claim и обоснованные RPO/RTO
  решения конкретного продукта; deployment smoke `PF-02` остаётся независимым.
- **Priority:** P0 для каждого production deployment; repository Core operations
  contract уже достаточен до выбора environment.
- **Reasons to defer / non-goals:** не добавлять встроенный backup worker,
  repository-owned scheduler, generic S3 service или destructive in-place
  restore.
- **Evidence:**
  [`postgres-backup-restore.md`](runbooks/postgres-backup-restore.md).

### `PF-04`. Dependency update automation

- **Entry kind:** Repository maintenance.
- **Catalog status:** Validated candidate.
- **What already exists:** dependencies и Actions pinned точно, application PR
  gate запускает `pnpm check`; Stage image publication/Trivy/OCI smoke доступны
  для same-repository path и намеренно исключают Dependabot pull requests. Updater
  configuration и update cadence отсутствуют.
- **What could be added:** один repository-owned update bot contract с bounded
  grouping, расписанием и обязательным прохождением обычных review/CI gates.
- **Named consumer:** текущий `nest-js-starter` и каждая независимая копия,
  сохраняющая exact dependency policy.
- **Failure model:** exact pins устаревают незаметно, security fixes не
  поднимаются либо редкий большой update смешивает несовместимые изменения;
  автоматический merge может опубликовать непроверенный artifact.
- **Form:** Not applicable; сопровождает exact dependency policy repository.
- **Required dependencies:** существующий application PR gate — Available;
  grouping, cadence и maintainer ownership — Repository-owned.
- **Conditional dependencies:** выбранный Git hosting updater, его actor,
  permissions и соответствующее trust condition; image-affecting update требует
  отдельный trusted maintainer verification path.
- **Blocked by:** решение о cadence/grouping и ответственном за review; новый
  application abstraction не требуется.
- **Unlocks:** меньший maintenance lag exact dependencies, Actions и base images.
- **Priority:** P2; выбирать после evidence повторяемого maintenance lag или
  неприемлемой стоимости ручных updates.
- **Reasons to defer / non-goals:** не включать auto-merge, широкие update groups,
  обход full gates или publication из updater pull request без отдельного
  решения о trust policy.
- **Evidence:** текущие
  [PR](../.github/workflows/pull-request.yml) и
  [Stage image](../.github/workflows/stage-image.yml) workflows не содержат
  updater configuration.

### `PF-05`. OpenAPI backward-compatibility gate

- **Entry kind:** Repository maintenance.
- **Catalog status:** Validated candidate.
- **What already exists:** committed OpenAPI, deterministic drift, lint и e2e
  response conformance; contract changes требуют явного review.
- **What could be added:** comparison с одной immutable previous contract
  identity и policy для допустимых/ломающих изменений.
- **Named consumer:** `react-starter`, который генерирует TypeScript/Zod client
  из backend OpenAPI; обязательство сохранять совместимость между независимо
  выпущенными версиями пока не установлено.
- **Failure model:** backend release удаляет operation, field, status или schema,
  а отдельно выпущенный frontend продолжает ожидать старый contract; обратный
  риск — gate блокирует намеренное breaking изменение без versioning path.
- **Form:** Not applicable; сопровождает Core OpenAPI contract.
- **Required dependencies:** explicit compatibility/versioning policy и stable
  comparison baseline из trusted base ref/tag или опубликованного OpenAPI
  artifact — Missing.
- **Conditional dependencies:** generated-client compilation, только если она
  остаётся отдельным полезным consumer proof.
- **Blocked by:** решение, что backend обязан поддерживать старый independently
  released consumer, и выбор trusted immutable baseline без sibling checkout.
- **Unlocks:** контролируемые independent releases backend и clients.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не возвращать удалённый checker только из-за
  оставшегося fixture, не зависеть от sibling checkout, не включать comparison в
  Git-free `pnpm check` и не считать любой diff ошибкой.
- **Evidence:** текущий intentional-review contract в
  [`openapi-contracts.md`](architecture/openapi-contracts.md).

### `PF-06`. Runtime metrics, SLO and alerting

- **Entry kind:** Capability.
- **Catalog status:** Rejected как одна combined generic capability.
- **What already exists:** structured logs, trace-only OpenTelemetry и локальный
  Loki/Tempo pipeline; metrics/exporter, dashboard и alert rules отсутствуют
  сознательно.
- **What could be added:** bounded low-cardinality metrics Kit и
  provider-specific dashboards/alerts поверх конкретных service objectives.
- **Named consumer:** отсутствует service/operator с утверждёнными availability,
  latency или error-budget objectives.
- **Failure model:** деградация обнаруживается поздно; преждевременный generic
  metrics layer создаёт high cardinality, alert fatigue и ложную readiness
  dependency от telemetry backend.
- **Form:** Kit для mechanics + provider-specific Reference для dashboards и
  alerts.
- **Required dependencies:** named SLO, operator owner, metric catalog и backend
  — Missing/Product-owned.
- **Conditional dependencies:** auth, queue и outbox metrics только для
  включённых product flows.
- **Blocked by:** конкретный операторский вопрос и alert response procedure.
- **Unlocks:** измеримое production SLO и capacity diagnostics.
- **Priority:** —.
- **Reasons to defer / non-goals:** не добавлять Prometheus/OTel metrics «на
  будущее», не экспортировать unbounded route/user/provider labels и не делать
  collector health dependency. После concrete SLO направление может вернуться
  отдельными карточками для metrics mechanics, product SLO и environment alerts.
- **Evidence:** trace-only boundary в
  [`errors-logging-observability.md`](architecture/errors-logging-observability.md).

### `PF-07`. Secret-manager deployment adapter

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** protected environment-file contract, preflight,
  non-secret placeholders и manual rotation/compromise runbooks.
- **What could be added:** provider-specific injection and rotation Reference for
  a selected hosting platform.
- **Named consumer:** отсутствует deployment с выбранным secret-management
  provider и обязательной rotation topology.
- **Failure model:** secret попадает в argv/log/history, partial rotation
  оставляет процессы с разными ключами либо provider outage блокирует startup.
- **Form:** provider-specific Reference, не generic platform Kit.
- **Required dependencies:** provider, injection mechanism, availability и
  rotation contract — Missing.
- **Conditional dependencies:** agent, sidecar, mounted file или SDK зависят от
  конкретной deployment topology.
- **Blocked by:** выбранный provider и реальный rotation procedure.
- **Unlocks:** provider-managed secret lifecycle конкретного deployment.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не строить generic Vault abstraction и не
  менять runtime config API до появления provider consumer.
- **Evidence:** поддерживаемая manual boundary в
  [`deployment-security.md`](runbooks/deployment-security.md).

### `PF-08`. Multi-replica rolling deployment

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** один migration-first API deployment, external Caddy,
  shared PostgreSQL/auth Redis и schema-compatible API-only rollback.
- **What could be added:** expand/contract migration policy, mixed-version
  compatibility checks, rolling traffic/drain Reference и product-specific
  coordination для singleton background work.
- **Named consumer:** отсутствует проект с доказанным replica или zero-downtime
  requirement.
- **Failure model:** old/new code одновременно несовместимы со schema,
  migrations запускаются конкурентно, background work дублируется или mixed
  secret versions ломают sessions.
- **Form:** deployment Reference; конкретная topology остаётся environment-owned.
- **Required dependencies:** real multi-replica topology, availability SLO,
  load balancer/orchestrator и schema compatibility policy — Missing.
- **Conditional dependencies:** leases/leader election только для конкретной
  singleton work.
- **Blocked by:** named deployment и допустимый downtime/error budget.
- **Unlocks:** безопасный horizontal scale и rolling releases выбранного
  продукта.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не добавлять Kubernetes/operator abstraction
  и не усложнять текущий one-API manual path без topology consumer.
- **Evidence:** single-API contract в
  [`deployment.md`](runbooks/deployment.md).

### `PF-09`. SBOM, signing and attestations

- **Entry kind:** Repository maintenance.
- **Catalog status:** Rejected как один combined generic control; отдельные SBOM,
  signing или provenance entries остаются Deferred до control-specific consumer.
- **What already exists:** pinned Actions, immutable digest, same-digest smoke,
  non-root runtime и Trivy High/Critical scan.
- **What could be added:** отдельный SBOM control для inventory/scanner consumer;
  отдельно signing или provenance с trust identity и deployment-side verifier.
- **Named consumer:** отсутствует inventory/security/compliance owner для SBOM
  или deployment verifier для signing/provenance, принимающий решение по этим
  artifacts.
- **Failure model:** без SBOM inventory/scanner не может сопоставить уязвимый или
  запрещённый component с выпущенным image; build compromise или artifact
  substitution остаются незамеченными без signing/provenance verifier. Любой
  artifact без принимающего решения consumer становится декоративным и создаёт
  ложную уверенность.
- **Form:** Not applicable; сопровождает OCI release contract.
- **Required dependencies:** для SBOM — inventory/scanner consumer; для signing
  или provenance — concrete trust policy, identity lifecycle и
  deployment-side enforcement. Все prerequisites — Missing.
- **Conditional dependencies:** provider transparency log, artifact retention и
  scanner integration для соответствующего control.
- **Blocked by:** control-specific consumer: inventory/scanner workflow для SBOM
  либо trust verifier и enforcement rule для signing/provenance.
- **Unlocks:** только конкретные compliance и supply-chain controls.
- **Priority:** —.
- **Reasons to defer / non-goals:** не связывать SBOM, signing и provenance в
  обязательный all-in-one mechanism; не возвращать custom pin validators,
  attestation readers, evidence schemas или digest resolvers без их собственного
  consumer/enforcement point.
- **Evidence:** текущая намеренно узкая граница в
  [`oci-supply-chain.md`](architecture/oci-supply-chain.md).

### Сводка зависимостей

| Entry   | Required before implementation/evidence                                             | Conditional                                                   |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `PF-01` | Git-independent tests плюс existing runtime, Compose и OCI gates                    | Маленький script только после доказанной ошибки ручного smoke |
| `PF-02` | Immutable image, production host, Caddy/DNS/TLS, secrets и deployment runbooks      | Hosted telemetry; `PF-03` только для общего recovery claim    |
| `PF-03` | PostgreSQL roles, backup/checksum tooling, credentials, off-host и isolated targets | Ongoing scheduler/alerts; product retention/encryption policy |
| `PF-04` | Application PR gate, grouping/cadence и review ownership                            | Hosting updater; trusted image verification path              |
| `PF-05` | Compatibility/versioning policy и trusted immutable contract baseline               | Generated-client compilation                                  |
| `PF-06` | Named SLO, operator owner, metric catalog и backend                                 | Feature-specific auth/queue/outbox metrics                    |
| `PF-07` | Selected secret provider, injection/availability и rotation contract                | Agent/sidecar/file/SDK topology                               |
| `PF-08` | Multi-replica topology, availability objective, orchestrator и schema compatibility | Leases/leader election                                        |
| `PF-09` | Control-specific inventory/scanner или trust/verifier consumer                      | Transparency, artifact retention, scanner integration         |

`PF-01` — единственная следующая repository-owned foundation task. `PF-02` и
`PF-03` — независимые environment evidence gates: вместе они нужны только для
широкой production-readiness декларации и не требуют нового runtime module.
`PF-04` и `PF-05` не зависят от clean-copy и выбираются отдельно после
подтверждённого maintenance/compatibility trigger; остальные направления
остаются trigger-gated или rejected.

### Maintenance findings, не capabilities

- Lifecycle traffic gate сейчас возвращает отдельный минимальный JSON `503`,
  минуя application RFC 9457 filter. Нужно отдельным change решить, является ли
  это документированным lifecycle exception или должно использовать общий
  `DEPENDENCY_UNAVAILABLE` contract; рекомендация — сохранить единый client
  failure shape.
- Documentation audit в этом slice исправляет устаревшие заявления о config,
  runtime metrics, TypeScript compiler и несуществующем OpenAPI script. Такие
  несоответствия являются evidence для `PF-01`, но не новыми platform modules.

## 2. Human authentication и account assurance

### Граница категории

Эта категория отвечает за human account principal, аутентификаторы, browser
sessions, восстановление контроля над аккаунтом и повышение assurance для
чувствительных действий. Она не доказывает реальную личность человека:
`emailVerifiedAt` подтверждает контроль mailbox в момент ceremony, но не
является identity proofing или KYC.

Текущий auth runtime состоит из двух Core-границ и трёх default-disabled
Reference-вертикалей. Самостоятельного generic Identity Kit нет: механика
аутентификатора становится Kit только после повторения одного контракта и
failure model в нескольких независимых methods или products.

Все auth controllers входят в статическую API composition и committed OpenAPI;
public/protected metadata routes также статична. Feature modes не удаляют route:
после применимых authentication/permission guards policy конкретной
Reference-вертикали отвечает безопасным `NOT_FOUND`, когда capability выключена.

### `ID-01`. Human password authentication and account principal

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** PostgreSQL хранит stable user ID, password
  credential, mailbox-verification state, account status, code-owned role keys,
  per-user session generation и singleton global epoch. Core предоставляет
  Argon2id login/rehash, generic credential failure, fixed distributed login
  throttling, fresh durable principal projection на каждый request, RBAC и
  one-shot initial-admin плюс subsequent-user CLI provisioning.
- **What could be added:** отдельная prospective-password policy `ID-06`; она не
  меняет существующий password verification/rehash contract.
- **Named consumer:** default API и `react-starter`; Amazing EKB повторно
  использует тот же password/session/RBAC foundation для своего operator API.
- **Failure model:** enumeration через разные login ответы или timing; stale
  account/role projection; неизвестная role; concurrent credential change;
  bypass rate limit; PostgreSQL или auth Redis loss. Core отвечает generic
  `401`, explicit verified-mailbox `403`, `429` с `Retry-After` и fail-closed
  dependency `503`.
- **Form:** Core.
- **Required dependencies:** Core config/HTTP/logging, PostgreSQL и auth Redis —
  Available; immutable product role catalog — Product-owned.
- **Conditional dependencies:** mailbox delivery требуется только Reference
  flows `ID-03`/`ID-05`; она не является login dependency.
- **Blocked by:** нет.
- **Unlocks:** `ID-02`–`ID-11` и authenticated product modules.
- **Priority:** P0 preservation; capability уже реализована, это не новый
  roadmap item.
- **Reasons to defer / non-goals:** не превращать account principal в proof
  реальной личности, generic credential repository, organization membership или
  machine principal; не переносить product roles в dynamic role CRUD.
- **Evidence:** [`auth-core.md`](architecture/auth-core.md),
  [`login.use-case.ts`](../src/modules/auth/application/login.use-case.ts) и
  [`api.module.ts`](../src/bootstrap/api/api.module.ts).

### `ID-02`. Opaque browser sessions and self-revocation

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** finite idle/absolute Redis sessions addressed by an
  HMAC of a 256-bit opaque cookie; independent public ID and CSRF seed; atomic
  issue/touch/revoke/index scripts; owner-scoped list/revoke-one, logout и
  durable-generation-first logout-all. Safe output содержит timestamps,
  bounded User-Agent label и current-session marker; raw token и HMAC network
  fingerprint наружу не выходят.
- **What could be added:** ничего для базового session lifecycle. Stable trusted
  device, device attestation и risk decisions являются отдельным отвергнутым в
  generic виде направлением `ID-12`.
- **Named consumer:** browser auth самого starter; тот же backend contract
  повторён в Amazing EKB. `react-starter` использует current session и
  administrator logout-all, хотя отдельной self-service devices page пока нет.
- **Failure model:** Redis loss закрывает authentication/list/revoke fail-closed;
  malformed record удаляется; concurrent touch не воскрешает revoked session;
  durable logout-all/password transition остаётся действующей даже при
  incomplete eager Redis cleanup.
- **Form:** Core.
- **Required dependencies:** `ID-01` — Available; auth Redis lifecycle,
  persistence и recovery contract — Available/Environment-owned.
- **Conditional dependencies:** Redis backup/restore evidence требуется только
  для production recovery claim конкретного deployment.
- **Blocked by:** нет.
- **Unlocks:** все authenticated References, factor enrollment, recent-auth и
  external-provider session issuance.
- **Priority:** P0 preservation; capability уже реализована.
- **Reasons to defer / non-goals:** не считать User-Agent device identity,
  network fingerprint authentication factor или session cookie device
  attestation; не хранить raw cookies в PostgreSQL/logs.
- **Evidence:**
  [`session-store.port.ts`](../src/modules/auth/application/session-store.port.ts),
  [`auth.controller.ts`](../src/modules/auth/presentation/auth.controller.ts) и
  [`session-management.e2e.spec.ts`](../test/e2e/auth/session-management.e2e.spec.ts).

### `ID-03`. Self-service email/password account lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** default-disabled registration, mailbox verification
  с bounded resend и non-enumerating password-reset request/confirmation;
  purpose-specific digest-only expiring single-use tokens; public Redis limits
  и response floor; PostgreSQL commit before bounded best-effort SMTP delivery;
  fragment action URLs и enable/outage/disable/rollback runbook.
- **What could be added:** только consumer-specific frontend/deployment adoption.
  Более сильная durable mail-delivery policy принадлежит категории 6 и должна
  иметь собственный loss contract.
- **Named consumer:** `react-starter` реализует полный public lifecycle из
  committed backend OpenAPI; local Mailpit является transport evidence, а не
  production consumer.
- **Failure model:** account enumeration, token theft/replay/rotation race,
  duplicate registration, mail outage после commit, limiter bypass, invalid
  origin или fragment leakage. Unknown и eligible requests имеют одинаковый
  accepted shape/floor; token confirmation остаётся atomic single-use.
- **Form:** default-disabled Reference.
- **Required dependencies:** `ID-01` и `ID-02`, PostgreSQL token state, auth
  Redis public limiter, auth-owned mail port, public app origin и matching CORS
  origin — Available; hosted SMTP/DNS/secrets — Environment-owned при adoption.
- **Conditional dependencies:** category 6 attempts/outbox/worker, только если
  продукт больше не принимает текущую best-effort потерю delivery.
- **Blocked by:** repository blockers отсутствуют; enablement требует выбранный
  frontend origin и SMTP environment.
- **Unlocks:** public email/password onboarding и возможный `ID-07`.
- **Priority:** —; capability уже Available, activation Product-owned.
- **Reasons to defer / non-goals:** не включать OIDC, passkeys, MFA, primary
  email change, notification templates/preferences или identity proofing; не
  делать SMTP readiness dependency.
- **Evidence:**
  [`self-service-account-lifecycle.md`](runbooks/self-service-account-lifecycle.md)
  и
  [`self-service-auth.controller.ts`](../src/modules/auth/presentation/self-service-auth.controller.ts).

### `ID-04`. Administrative account lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** default-disabled protected list/detail, code-owned
  role catalog/replacement, `ACTIVE ↔ DISABLED`, target logout-all и terminal
  retirement. Mutations используют strong ETag/`If-Match`, запрещают
  self-mutation и reauthorize acting administrator внутри transaction после
  ordered row locks. Retirement удаляет auth credentials/tokens/roles,
  tombstones email и сохраняет user ID/product foreign keys.
- **What could be added:** ничего для текущего operator contract. Self-service
  closure, legal erasure и product-data retention принадлежат категории 8.
- **Named consumer:** merged account-administration UI в `react-starter` для
  list/detail, status, roles, logout-all, retirement и role catalog.
- **Failure model:** stale operator view/lost update, self-lockout,
  deauthorized actor race, invalid state transition, unknown role, Redis cleanup
  failure или ошибочное destructive retirement. ETag errors различают missing,
  malformed и stale preconditions; durable state/generation остаются
  authoritative при cleanup failure.
- **Form:** default-disabled Reference.
- **Required dependencies:** `ID-01`, `ID-02`, PostgreSQL transactions и
  product-owned role catalog — Available/Product-owned.
- **Conditional dependencies:** product-owned retention/FK policy определяет,
  какие данные переживают auth retirement.
- **Blocked by:** нет для repository capability; production activation требует
  provisioned administrator и явные permissions.
- **Unlocks:** `ID-05` и bounded operator account controls.
- **Priority:** —; capability уже Available.
- **Reasons to defer / non-goals:** не добавлять hard delete, generic account
  CRUD, dynamic roles, self-service erasure, support impersonation или
  administrator-set password.
- **Evidence:**
  [`account-administration.md`](runbooks/account-administration.md),
  [`admin-account.controller.ts`](../src/modules/auth/presentation/admin-account.controller.ts)
  и
  [`account-administration.e2e.spec.ts`](../test/e2e/auth/account-administration.e2e.spec.ts).

### `ID-05`. Administrator-sponsored invitation and recovery

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** отдельный default-disabled mode для create/resend
  invitation, public single-use acceptance и administrator-triggered reset.
  Acceptance sets password/verifies mailbox/activates account without issuing a
  browser session; administrator never chooses or receives a password. Durable
  transition precedes SMTP, а actual outcome возвращается как
  `mailDelivery: delivered|failed`.
- **What could be added:** только provider/frontend adoption. Stronger generic
  notification delivery не принадлежит этой Reference-вертикали.
- **Named consumer:** `react-starter` account administration реализует
  invitation, resend, recovery и public acceptance flows.
- **Failure model:** unauthorized sponsor, duplicate email/unknown role,
  replaced/expired/replayed token, concurrent acceptance, password-reset source
  confusion, mail outage после commit или ошибочная выдача user session
  administrator. Persistence и audit различают state conflict от delivery
  failure.
- **Form:** default-disabled Reference.
- **Required dependencies:** `ID-04` — Available hard dependency; `ID-01`,
  `ID-02`, one-time-token/mail contracts, public limiter, app URL/CORS и SMTP —
  Available/Environment-owned.
- **Conditional dependencies:** `ID-03` activation не требуется; обе References
  лишь используют общий reset-confirm/token/mail mechanism. Category 6 нужна
  только при более сильном delivery contract.
- **Blocked by:** repository blockers отсутствуют; mode validation требует
  enabled `ID-04` и complete frontend/SMTP configuration.
- **Unlocks:** operator-sponsored onboarding без password disclosure и bounded
  administrator recovery.
- **Priority:** —; capability уже Available.
- **Reasons to defer / non-goals:** не создавать session при acceptance, не
  разрешать admin-set password, не смешивать recovery с impersonation и не
  превращать auth mail в notification platform.
- **Evidence:**
  [`account-administration.md`](runbooks/account-administration.md),
  [`account-email-workflows.service.ts`](../src/modules/auth/application/account-email-workflows.service.ts)
  и
  [`account-email-workflows.controller.ts`](../src/modules/auth/presentation/account-email-workflows.controller.ts).

### `ID-06`. Prospective-password acceptance policy and blocklist

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Argon2id hashing, login throttling и bounded password
  DTO/CLI input. Шесть concrete flows устанавливают новый password, но общей
  проверки commonly used/expected/compromised values нет; HTTP new-password
  contracts используют текущую длину `12..1024`, а CLI additionally bounds
  secret bytes.
- **What could be added:** одна auth-owned prospective-password policy,
  вызываемая только при установке/смене password после дешёвой
  authorization/token eligibility и до Argon2. Она сравнивает полное значение с
  выбранным blocklist, выдаёт стабильную value-free rejection и явно фиксирует
  source/update/outage contract; текущий minimum отдельно сверяется с выбранным
  security baseline, а не меняется молча.
- **Named consumer:** initial-admin CLI, create-user CLI, public registration,
  authenticated change-password, self-service/administrator reset confirmation
  и invitation acceptance; `react-starter` предоставляет public flows, Amazing
  EKB повторяет operator/change-password часть.
- **Failure model:** неполное покрытие создаёт bypass; stale local data пропускает
  compromised values; remote lookup раскрывает password-derived data или
  блокирует bootstrap/recovery из-за outage/rate limit; policy внутри
  `PasswordHasher.hash()` ломает успешный login, когда тот вызывает hash только
  для opportunistic rehash уже принятого password.
- **Form:** Core auth policy; local data source или remote adapter остаётся
  implementation choice, а не generic platform Kit.
- **Required dependencies:** `ID-01` и все retained password-setting flows —
  Available; prospective-password policy, blocklist source и update lifecycle —
  Missing/Repository-owned.
- **Conditional dependencies:** local bundled list либо remote provider с
  explicit privacy/timeout/fail-open-or-closed policy; `ID-03` и `ID-05` обязаны
  применять ту же policy только если сохраняются в копии.
- **Blocked by:** выбор security baseline, list source/refresh cadence, stable
  public error и outage policy. Технического consumer blocker нет.
- **Unlocks:** единый password-acceptance contract без обхода между CLI, public
  и operator flows.
- **Priority:** P1; единственный новый repository-owned кандидат этой категории
  с несколькими действующими consumers.
- **Reasons to defer / non-goals:** не прятать policy в password hasher или login
  rehash; не добавлять password history, periodic rotation, arbitrary complexity
  rules, remote breach API или generic secret-policy framework без отдельного
  решения.
- **Evidence:** password-setting calls in
  [`create-initial-admin.use-case.ts`](../src/modules/auth/application/create-initial-admin.use-case.ts),
  [`create-user.use-case.ts`](../src/modules/auth/application/create-user.use-case.ts),
  [`register-user.use-case.ts`](../src/modules/auth/application/register-user.use-case.ts),
  [`change-password.use-case.ts`](../src/modules/auth/application/change-password.use-case.ts),
  [`confirm-password-reset.use-case.ts`](../src/modules/auth/application/confirm-password-reset.use-case.ts)
  and
  [`account-email-workflows.service.ts`](../src/modules/auth/application/account-email-workflows.service.ts);
  current external direction in
  [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver).

### `ID-07`. Verified primary-email change

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** normalized email is unique, active email is immutable,
  mailbox verification exists for onboarding, и retirement releases the
  original address by replacing it with a tombstone. Email-change state/token
  flow отсутствует.
- **What could be added:** authenticated primary-login-email change with recent
  reauthentication, reserved new address, verification of the new mailbox,
  security notice to the old mailbox и explicit rollback/session/reset-token
  policy.
- **Named consumer:** отсутствует product flow, где пользователь должен изменить
  primary login email; retirement плюс new invitation не является таким flow.
- **Failure model:** stolen session захватывает account через новый mailbox;
  uniqueness race; old mailbox недоступен; delivery loss оставляет ambiguous
  pending state; stale verification/reset tokens или existing sessions продолжают
  использовать старую identity assumption.
- **Form:** Reference.
- **Required dependencies:** `ID-01`, `ID-02`, recent reauthentication,
  transactionally reserved address, new-mailbox proof и recovery/rollback
  policy — Available/Missing.
- **Conditional dependencies:** token/mail primitives `ID-03` переиспользуются,
  только если эта Reference сохраняется в копии; category 6 security
  notice/durable delivery нужна, если product loss contract не принимает
  best-effort mail; external identities `ID-10` не меняются автоматически.
- **Blocked by:** named consumer и решения: является ли email login identifier,
  что делать без старого mailbox, какие sessions/tokens инвалидировать.
- **Unlocks:** user-maintained email/password identity в concrete self-service
  product.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не считать обычное profile/contact поле
  primary identity, не auto-update provider claims, не смешивать с privacy
  erasure или generic contacts module.
- **Evidence:** immutable active-email boundary in
  [`roadmap.md`](roadmap.md#milestone-10-account-administration) and retirement
  contract in [`account-administration.md`](runbooks/account-administration.md).

### `ID-08`. Passkeys and WebAuthn credential lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `ID-01`/`ID-02` предоставляют stable account principal
  и post-auth browser session. WebAuthn dependency, challenge/credential model,
  ceremony endpoints и UI отсутствуют.
- **What could be added:** одна WebAuthn Relying Party Reference с registration
  and authentication ceremonies, single-use bounded challenges, scoped opaque
  user handles, multiple credential list/revoke, user-verification/attestation
  policy и recovery/last-authenticator invariant.
- **Named consumer:** отсутствует concrete client, требующий passwordless или
  phishing-resistant authenticator; наличие browser в `react-starter` само по
  себе не является adoption trigger.
- **Failure model:** challenge replay/race, RP ID/origin mismatch, credential
  probing/privacy leak, PII in user handle, lost authenticator lockout,
  factor removal через stolen session или неверная интерпретация signature
  counter/attestation.
- **Form:** сначала factor-specific Reference; общий ceremony Kit возможен только
  после второго независимо совпавшего consumer contract.
- **Required dependencies:** `ID-01`, `ID-02`, production HTTPS/secure context,
  fixed RP ID/origin, challenge state, credential persistence и recovery policy
  — Available/Missing/Product-owned.
- **Conditional dependencies:** `ID-09`, если passkey служит step-up factor;
  attestation trust store только при конкретном hardware policy.
- **Blocked by:** named product, RP topology, user-verification/attestation
  choices и допустимый recovery/lockout contract.
- **Unlocks:** phishing-resistant primary authentication либо factor для
  `ID-09`.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не добавлять generic MFA framework, не
  хранить biometric data на server, не считать passkey stable physical-device
  identity и не проектировать recovery после одной login button.
- **Evidence:** absence documented in [`auth-core.md`](architecture/auth-core.md)
  and current protocol boundary in
  [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/).

### `ID-09`. Privileged-action step-up, MFA and recovery

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** current-password verification защищает password
  change, а durable session invalidation закрывает reset/logout flows. Session
  record не несёт recent-auth time/assurance method, дополнительных factors и
  recovery codes нет.
- **What could be added:** product-owned assurance policy для named sensitive
  action, recent-reauth proof/session context, factor enrollment/change/removal,
  factor-specific verifier и hashed single-use recovery artifacts. `ID-08` может
  быть первым factor, но не является hard dependency.
- **Named consumer:** отсутствует action с утверждённым assurance target;
  существующие admin permissions/ETag не доказывают требование MFA.
- **Failure model:** stolen session enrolls/removes factor, recovery оказывается
  слабее MFA, factor loss permanently locks account, TOTP/code replay или clock
  drift, inconsistent step-up enforcement между endpoints и notification loss
  после factor change.
- **Form:** Product-specific assurance policy + factor-specific Reference; не
  generic MFA engine.
- **Required dependencies:** `ID-01`, `ID-02`, named protected action,
  assurance/recent-auth representation, secure enrollment/removal и recovery
  contract — Available/Missing/Product-owned.
- **Conditional dependencies:** `ID-08` для WebAuthn factor либо отдельный TOTP
  Reference; category 6 security notices после factor/recovery changes.
- **Blocked by:** concrete product risk, acceptable factor и recovery strength.
- **Unlocks:** step-up protection для high-value product/admin actions.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не включать SMS или security questions по
  умолчанию, не строить provider-neutral factor registry и не считать active
  cookie достаточной reauthentication для factor replacement.
- **Evidence:** current password/session boundary in
  [`auth-core.md`](architecture/auth-core.md) and recovery/change guidance in
  [OWASP MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

### `ID-10`. Single-provider external human identity federation

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** stable local user ID/account/session foundation.
  External identity table, OIDC provider/client, callback ceremony и token/JWKS
  handling отсутствуют.
- **What could be added:** один provider-specific OIDC Authorization Code flow
  with PKCE/state/nonce, strict issuer/audience/time validation, JWKS
  rotation/outage policy и durable unique mapping by `(issuer, subject)`.
  JIT account creation, local-password coexistence и recovery выбираются до
  implementation.
- **Named consumer:** отсутствует selected provider/client. Telegram `from.id` в
  Gift Bot является transport-native product identity, а не OIDC federation
  local account.
- **Failure model:** login CSRF/code replay, wrong issuer/audience/nonce,
  key-rotation outage, provider unavailability, duplicate local account, linking
  by mutable/reused email или unlinking the last authenticator.
- **Form:** provider-specific Reference.
- **Required dependencies:** `ID-01`, `ID-02`, selected provider/client/redirect,
  `(issuer, subject)` persistence и account-creation/recovery policy —
  Available/Missing/Product-owned.
- **Conditional dependencies:** `ID-03`, если local password signup remains;
  `ID-11` только для explicit linking. Organization connection, discovery и
  tenant enablement принадлежат категории 3, но такой SSO flow использует
  human OIDC ceremony и local mapping этой capability.
- **Blocked by:** named provider, concrete client flow и ownership of provider
  outage/account collision decisions.
- **Unlocks:** external-provider sign-in одного выбранного product.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не строить generic identity broker,
  multi-provider registry или SAML/enterprise tenant discovery; не использовать
  email как stable external ID и не считать provider authentication identity
  proofing.
- **Evidence:** current exclusion in [`auth-core.md`](architecture/auth-core.md)
  and stable-identifier requirement in
  [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability).

### `ID-11`. Multiple authenticators and explicit account linking

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** local account has one password credential and unique
  email. External identities, passkeys, account merge/link/unlink и
  last-authenticator invariant отсутствуют.
- **What could be added:** explicit add/link/unlink ceremony after recent
  authentication, stable authenticator identity mapping, collision-safe merge
  decision, audit/security notice и recovery rule that prevents removing the
  last usable authenticator.
- **Named consumer:** отсутствует product with two supported authenticator
  methods and a real user migration/linking flow.
- **Failure model:** auto-link by matching email gives account takeover;
  concurrent link creates duplicate identities; recycled/mutable provider claim
  attaches wrong account; merge collides with product foreign keys; unlink
  leaves unrecoverable account.
- **Form:** Product-specific first; promote to Reference only after repeated
  ceremony and failure model.
- **Required dependencies:** at least two accepted methods among local password,
  `ID-08` and `ID-10`; recent reauthentication, stable method identifiers,
  last-authenticator/recovery invariant и product merge policy — Missing.
- **Conditional dependencies:** category 6 security notices; organization-owned
  federation из категории 3 использует эту capability, только если разрешает
  linking нескольких authenticators.
- **Blocked by:** two real methods, named migration/linking consumer и explicit
  collision/recovery decisions.
- **Unlocks:** controlled migration between login methods and provider
  portability.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не вводить generic credential table заранее,
  не auto-link по email и не смешивать account linking with profile merge or
  organization membership.
- **Evidence:** absent persistence boundary in
  [`schema.prisma`](../prisma/schema.prisma) and external identifier semantics in
  [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability).

### `ID-12`. Generic adaptive risk and trusted-device engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected как generic capability; отдельный
  Product-specific risk flow может вернуться после concrete fraud evidence.
- **What already exists:** HMAC-keyed fixed IP/account login throttling, generic
  credential failures, bounded session `deviceLabel`, internal HMAC network
  fingerprint и durable invalidation. Fingerprint сохраняется как metadata и не
  влияет на authentication decision.
- **What could be added:** только product-specific detection/challenge flow с
  измеримыми signals, false-positive budget, privacy retention и operator/user
  response. Это не расширение текущего device label.
- **Named consumer:** отсутствует product с fraud losses, accepted signals и
  response procedure; Amazing EKB повторяет только fixed throttling.
- **Failure model:** spoofable IP/User-Agent воспринимаются как identity,
  trusted-device cookie становится bypass authenticator, geolocation/reputation
  creates privacy/outage dependency, false positives lock users out, а risk
  score без явного product enforcement/response ничего не меняет.
- **Form:** Rejected generic capability; возможная будущая форма —
  Product-specific.
- **Required dependencies:** для rejected entry — нет; future flow потребует
  named fraud model, signals, privacy/retention, calibrated decision и recovery.
- **Conditional dependencies:** `ID-09` как challenge/step-up action, если
  product принимает adaptive authentication.
- **Blocked by:** отсутствующие consumer, measurable risk и response owner.
- **Unlocks:** только конкретный fraud/risk scenario, не остальные auth methods.
- **Priority:** —.
- **Reasons to defer / non-goals:** не повышать User-Agent/IP metadata до device
  identity, не добавлять CAPTCHA/IP reputation/geolocation по умолчанию и не
  создавать generic rules engine.
- **Evidence:** metadata creation in
  [`auth.module.ts`](../src/modules/auth/composition/auth.module.ts) and fixed
  limiter in
  [`redis-login-rate-limiter.ts`](../src/modules/auth/infrastructure/redis-login-rate-limiter.ts).

### Сводка зависимостей

| Entry   | Required before implementation/adoption                                        | Conditional                                             |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ID-01` | Core config/HTTP/logging, PostgreSQL, auth Redis, product role catalog         | Mailbox delivery только для References                  |
| `ID-02` | `ID-01`, auth Redis lifecycle                                                  | Production Redis recovery evidence                      |
| `ID-03` | `ID-01`, `ID-02`, token state, public limiter, app origin/CORS, SMTP           | Category 6 durable delivery                             |
| `ID-04` | `ID-01`, `ID-02`, PostgreSQL transactions, role catalog                        | Product data-retention/FK policy                        |
| `ID-05` | `ID-04`, token/mail contracts, public limiter, app origin/CORS, SMTP           | `ID-03` activation не требуется; category 6 delivery    |
| `ID-06` | `ID-01`, all retained password-setting flows, list/update/outage policy        | Local source либо privacy-bounded remote adapter        |
| `ID-07` | `ID-01`, `ID-02`, recent auth, address reservation/proof/recovery policy       | `ID-03` token/mail reuse; security notices/durable mail |
| `ID-08` | `ID-01`, `ID-02`, HTTPS/RP identity, challenge/credential/recovery contracts   | `ID-09`; attestation only for named hardware policy     |
| `ID-09` | `ID-01`, `ID-02`, protected action, assurance/enrollment/recovery contracts    | `ID-08` or TOTP factor; security notices                |
| `ID-10` | `ID-01`, `ID-02`, provider/client, `(issuer, subject)`, outage/recovery policy | `ID-03` local signup; `ID-11` linking; category 3 SSO   |
| `ID-11` | Two accepted methods, recent auth, stable IDs, link/merge/recovery policy      | Security notices; category 3 when SSO supports linking  |
| `ID-12` | Rejected; future flow needs fraud model, signals, privacy and response owner   | `ID-09` challenge                                       |

```text
Production foundation
  -> ID-01
     -> ID-02
        -> ID-03
        -> ID-04 -> ID-05

ID-01 + retained password-setting flows -> ID-06
ID-01 + ID-02 + concrete factor/RP      -> ID-08
ID-01 + ID-02 + protected action        -> ID-09
ID-01 + ID-02 + concrete provider       -> ID-10
ID-08 or ID-10 + explicit link policy   -> ID-11
```

Category ownership остаётся строгим:

- organizations, memberships, tenant roles, API keys и service accounts
  принадлежат категории 3; machine principal не получает browser cookie и не
  притворяется `User`. Organization SSO там владеет connection/discovery/tenant
  policy, но зависит от `ID-10` для human OIDC ceremony и mapping, а от `ID-11`
  — только при explicit linking;
- notification templates/preferences/attempts/inbox принадлежат категории 6;
  auth владеет token eligibility и security ceremony;
- consent, product export/erasure, legal retention и support impersonation
  принадлежат категории 8; `ID-04` retirement является auth tombstone, а не
  full-product deletion;
- KYC/identity proofing появляется только как provider/product-specific
  regulated flow и не выводится из mailbox verification.

### Source-removal boundary для auth References

`ID-03`, `ID-04` и `ID-05` default-disabled в policy, но их controllers,
configuration, OpenAPI contracts и tests статически входят в copied source.
Удаление capability поэтому является source change, а не только выключением env:

- удалить только owning controllers/use cases/policy branches и composition
  providers, затем синхронизировать runtime schema/config docs, Problem Details,
  committed OpenAPI, tests/runbooks и generated React contracts/routes/pages;
- не удалять shared token, reset-confirm, password-policy/hasher, limiter или
  mail mechanics, пока их использует оставшаяся `ID-03` или `ID-05` vertical;
- `ID-05` зависит от `ID-04`: account-administration vertical нельзя удалить,
  сохранив invitations/admin recovery без отдельной адаптации owner contract;
- Prisma schema меняется только после проверки всех оставшихся flows; для уже
  применённой schema используется forward migration, затем Prisma/OpenAPI
  generation and validation.

В pristine copy до первого deployment AI-agent может удалить весь выбранный
slice сразу. В работающем проекте сначала сохраняются shared contracts и data,
которые ещё нужны другой auth capability.

### Maintenance findings, не capabilities

- `AdminAccountController` пока не декларирует `INTERNAL_ERROR` и
  `DEPENDENCY_UNAVAILABLE` во всех operations, способных получить PostgreSQL или
  Redis failure. Исправление decorators/committed OpenAPI является отдельным
  runtime-contract change, а не частью этого docs-only catalog slice.
- `globalSessionEpoch` хранится и проверяется, но поддерживаемого mutator
  endpoint/command нет; starter не заявляет operator global-logout capability.

## 3. Organizations и machine access

### Граница категории

Current Auth Core описывает human user, browser session и global code-owned
roles. Organization/workspace, membership, organization-owned resource, API
credential and machine principal отсутствуют. Ни Amazing EKB, ни Gift Bot, ни
React starter не подтверждают multi-organization vertical: global product roles
и static Telegram team allowlist не являются tenancy.

Category 3 владеет organization connection/discovery/membership and machine
identity. Human OIDC ceremony остаётся `ID-10`; product aggregate authorization
остаётся module-owned и не превращается в implicit global tenant middleware.

### `ORG-01`. Organization or workspace aggregate

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** stable human `User`, global roles and permissions;
  organization persistence and lifecycle отсутствуют.
- **What could be added:** organization ID, display name/slug, explicit owner,
  optimistic revision and product-owned `active/suspended/archived` lifecycle
  with archival/retention rules.
- **Named consumer:** отсутствует. Amazing EKB has one global product context;
  Gift Bot uses a static team allowlist; React starter has no organization UI.
- **Failure model:** duplicate organization identity, suspension not enforced on
  resources/credentials/jobs, archival leaves access active, last owner lost and
  organization mistaken for an automatic tenant filter.
- **Form:** Product-specific first; Reference after repeated aggregate semantics.
- **Required dependencies:** `ID-01` — Available; first genuinely
  organization-owned resource and lifecycle policy — Missing/Product-owned.
- **Conditional dependencies:** `ID-02` for browser-admin composition; category
  6 onboarding mail; category 8 business history and retention.
- **Blocked by:** named B2B/SaaS consumer and first organization-owned resource.
- **Unlocks:** `ORG-02`, `ORG-03`, organization-owned `ORG-04/05` and scoped
  category 10 entitlements.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать empty `organizations` table for
  possible future, не assume global multi-tenancy and не fold organization into
  auth `User`.
- **Evidence:** current human-only persistence in
  [`schema.prisma`](../prisma/schema.prisma) and global role catalog in
  [`role-registry.ts`](../src/modules/auth/application/role-registry.ts).

### `ORG-02`. Organization membership and invitation lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** global `UserRole` and account invitation `ID-05`;
  that flow creates/activates an account but does not create membership.
- **What could be added:** membership `invited/active/suspended/removed`, scoped
  role, invite/revoke/accept for existing or new account, ownership transfer and
  last-owner invariant.
- **Named consumer:** отсутствует.
- **Failure model:** invitation accepted by wrong account, stale invite restores
  removed member, concurrent accept duplicates membership, removal leaves
  resource access/session and last owner removes self.
- **Form:** Reference over Product-specific roles/resources.
- **Required dependencies:** `ORG-01`, `ID-01`, organization role/ownership
  policy, membership-administration authorization and last-owner invariant —
  Missing/Product-owned.
- **Conditional dependencies:** `ID-03` or category 6 delivery for invite;
  `ID-11` only when multiple login methods are linkable.
- **Blocked by:** `ORG-01` and a named collaboration flow.
- **Unlocks:** `ORG-03`, organization SSO and team administration.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не переименовывать account invitation в
  membership invitation and не add dynamic global role CRUD.
- **Evidence:** separate account/invitation models in
  [`schema.prisma`](../prisma/schema.prisma) and current `ID-05` boundary.

### `ORG-03`. Organization-scoped resource authorization

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** fresh human principal and global permission set;
  principal has no organization context, and no product resource is
  organization-owned.
- **What could be added:** explicit `organizationId` on a named aggregate,
  membership/resource authorization input and cross-organization denial tests.
  Database RLS is a separate topology/security decision, not a default.
- **Named consumer:** отсутствует; Approval Requests and Amazing EKB resources
  currently use user/global-product ownership.
- **Failure model:** cross-organization IDOR, background job/cache/idempotency key
  omits scope, accidental global-admin bypass and stale membership after removal.
- **Form:** Product-specific authorization policy; later a Reference pattern,
  never a global repository Kit.
- **Required dependencies:** `ORG-01`, `ORG-02`, named resource and explicit
  ownership model — Missing.
- **Conditional dependencies:** scope in queue/outbox envelope only for scoped
  work; RLS only after explicit threat/topology decision.
- **Blocked by:** absence of an organization-owned aggregate.
- **Unlocks:** safe SaaS collaboration, machine credentials and organization
  entitlements.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no middleware that silently injects tenant
  predicates, no global tenant context and no universal repository abstraction.
- **Evidence:** current principal shape in
  [`auth.types.ts`](../src/modules/auth/application/auth.types.ts) and user-owned
  approval controller in
  [`approval-request.controller.ts`](../src/modules/approval-requests/presentation/approval-request.controller.ts).

### `ORG-04`. Scoped API credentials

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** only opaque browser cookie plus session-bound CSRF.
  Logger redaction of strings named `apiKey` is defense in depth, not machine
  authentication.
- **What could be added:** one selected owner model, high-entropy secret shown
  once, public key ID/prefix plus digest, bounded product scopes, expiry/revoke,
  last-used metadata, overlap rotation and a distinct machine auth context.
- **Named consumer:** отсутствует. Telegram `BOT_TOKEN` is an outbound provider
  credential, not an inbound product principal; Amazing EKB exposes no customer
  machine client.
- **Failure model:** plaintext/key leakage, key probing, weak digest,
  cross-owner reuse, scope escalation, disabled owner leaves active key,
  rotation outage and secret in logs/OpenAPI.
- **Form:** user-owned or organization-owned Reference; ownership is chosen
  before implementation.
- **Required dependencies:** `ID-01` for user-owned or `ORG-01` for directly
  organization-owned keys; product permission catalog and machine auth boundary
  — Available/Missing.
- **Conditional dependencies:** `ORG-05` when the credential belongs to a
  service account; category 8 audit; per-key rate limit only for a named abuse
  contract.
- **Blocked by:** named external client and unresolved credential ownership.
- **Unlocks:** authenticated automation/import clients and webhook senders.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no browser cookie/CSRF emulation, unscoped
  permanent bearer token or generic OAuth authorization server.
- **Evidence:** current cookie-only OpenAPI security in
  [`openapi-document.ts`](../src/platform/http/docs/openapi-document.ts) and
  human principal in [`auth.types.ts`](../src/modules/auth/application/auth.types.ts).

### `ORG-05`. Service-account machine principal lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** authentication principal is human-only: user/session,
  email and roles. ServiceAccount persistence and principal discriminator are
  absent.
- **What could be added:** separate machine principal with owning organization,
  status, display name, explicit permissions, multiple credentials, disable and
  attributable creator/last-used metadata.
- **Named consumer:** отсутствует.
- **Failure model:** fake human accounts gain password recovery/browser session,
  shared credential loses attribution, machine survives owner retirement,
  deleting last credential stops production and machine inherits human roles.
- **Form:** Product-specific first; Reference after repeated lifecycle.
- **Required dependencies:** `ORG-01`, machine permissions and lifecycle policy
  — Missing/Product-owned.
- **Conditional dependencies:** `ORG-04` or another concrete credential when
  the principal becomes active; category 8 business audit; provider-managed
  client credentials only for selected provider.
- **Blocked by:** named machine actor and ownership/recovery policy.
- **Unlocks:** organization automation without human impersonation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не add `isServiceAccount` to `User`; no
  email/password, recovery mail or browser sessions for machine principals.
- **Evidence:** current `User` and principal contracts in
  [`schema.prisma`](../prisma/schema.prisma) and
  [`auth.types.ts`](../src/modules/auth/application/auth.types.ts).

### `ORG-06`. Organization SSO connection and discovery

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `ID-10` records human OIDC ceremony as absent;
  organization connection, verified domain, discovery and JIT membership are
  also absent.
- **What could be added:** one provider-specific organization connection,
  verified discovery, enable/disable policy, JIT or pre-provisioned membership,
  IdP outage recovery and break-glass access.
- **Named consumer:** отсутствует.
- **Failure model:** domain hijack attaches wrong IdP, issuer maps to wrong
  organization, outage locks all owners out, deprovisioned user keeps
  membership/session and JIT assigns excessive role.
- **Form:** provider-specific Reference.
- **Required dependencies:** `ORG-01`, `ORG-02`, `ID-10`, selected provider and
  tenant administrator approval — Missing.
- **Conditional dependencies:** `ID-11` only for explicit authenticator linking;
  SCIM only as a later provider-specific lifecycle.
- **Blocked by:** concrete enterprise organization/provider.
- **Unlocks:** enterprise sign-in for one organization.
- **Priority:** P3.
- **Reasons to defer / non-goals:** no generic identity broker, SAML/OIDC
  registry, domain-only trust or universal SCIM engine.
- **Evidence:** split ownership defined by `ID-10` and category 2/3 boundary in
  this catalog.

### `ORG-07`. Transparent global multi-tenancy and universal scopes engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** explicit module boundaries and code-owned global
  permissions; no tenant middleware.
- **What could be added:** only explicit product resource scoping under
  `ORG-03`.
- **Named consumer:** отсутствует; a roadmap direction is not a consumer.
- **Failure model:** one missed implicit filter leaks data, worker/CLI bypasses
  request middleware, permission vocabulary becomes ambiguous and generic scope
  tables make feature removal harder.
- **Form:** Rejected generic; future authorization remains Product-specific.
- **Required dependencies:** none for rejected entry.
- **Conditional dependencies:** explicit `ORG-03` is an alternative, not a
  dependency.
- **Blocked by:** rejected product-neutral contract.
- **Unlocks:** nothing independently.
- **Priority:** —.
- **Reasons to defer / non-goals:** no global tenant context, generic
  repository/controller/service or dynamic scopes table.
- **Evidence:** explicit boundaries in
  [`module-boundaries.md`](architecture/module-boundaries.md) and code-owned
  permissions in
  [`role-registry.ts`](../src/modules/auth/application/role-registry.ts).

### Сводка зависимостей

| Entry    | Required before implementation                                  | Conditional                                        |
| -------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `ORG-01` | `ID-01`, organization-owned resource and lifecycle              | `ID-02` browser admin, onboarding, audit/retention |
| `ORG-02` | `ORG-01`, account, membership role/admin authorization          | Identity or communication invite delivery          |
| `ORG-03` | `ORG-01/02`, named aggregate and ownership model                | Scoped jobs/outbox; explicitly selected RLS        |
| `ORG-04` | Named machine client, direct owner model, scopes and key policy | `ORG-05`, audit and abuse-specific rate limiting   |
| `ORG-05` | `ORG-01`, machine permissions and lifecycle policy              | Concrete credential, audit/provider integration    |
| `ORG-06` | `ORG-01/02`, `ID-10`, provider and tenant admin policy          | `ID-11` linking; later provider-specific SCIM      |
| `ORG-07` | Rejected generic tenancy/scopes engine                          | Explicit product `ORG-03` instead                  |

```text
ID-01 + named organization-owned resource
  -> ORG-01
     -> ORG-02
        -> ORG-03

ID-01 ---------------------> user-owned ORG-04
ORG-01 --------------------> direct organization-owned ORG-04
ORG-01 --------------------> ORG-05
ORG-05 + selected method --> service-account credential such as ORG-04
ORG-01 + ORG-02 + ID-10 ---> ORG-06
```

No organization card is currently a roadmap candidate: every one lacks a named
organization-owned product resource. This is an intentional category result,
not an incomplete audit.

## 4. Надёжность и фоновые процессы

### Граница категории

Category 4 owns reusable delivery/lifecycle mechanics, not product job state or
one universal retry policy. BullMQ and transactional Outbox are already
Available inert Kits. Product queue names, payloads, due state, idempotency,
attempt budget and operator recovery remain in the adopting module.

Integration Inbox remains `INT-02` until multiple provider intakes prove a
shared persistence/recovery contract. Import/export operations remain category
5; notifications category 6; workflow category 9; payment/order category 10.

### `REL-01`. BullMQ connection and standalone-worker lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** opt-in `REDIS_QUEUE_URL`, separate producer/worker
  ioredis policies, one root connection, bounded readiness, local persistent
  queue Redis profile and signal-driven Nest context close. Kit registers no
  product queue.
- **What could be added:** nothing generic; adopting feature supplies queue/job
  constants, producer port, processor, worker composition and recovery.
- **Named consumer:** Amazing EKB material and place import workers with distinct
  payload, concurrency, provider and durable-state semantics.
- **Failure model:** queue Redis outage/loss, ambiguous enqueue, duplicate
  delivery, worker crash or non-draining shutdown and auth/queue Redis collision.
  Product state/idempotency stay outside the Kit.
- **Form:** inert-by-default Kit.
- **Required dependencies:** validated queue URL, BullMQ/ioredis and process
  lifecycle — Available.
- **Conditional dependencies:** PostgreSQL when product state needs it;
  `REL-02` when transaction-to-enqueue loss is unacceptable.
- **Blocked by:** none for Kit; adoption requires a named workflow.
- **Unlocks:** product-owned durable jobs and `REL-02` BullMQ relay.
- **Priority:** P0 preservation after adoption; not a new roadmap item.
- **Reasons to defer / non-goals:** no product queue, payload, processor, worker
  executable, retry policy, dashboard or shared Redis with auth.
- **Evidence:** [`bullmq-connection.module.ts`](../src/platform/queue/bullmq-connection.module.ts),
  [`queue-readiness.indicator.ts`](../src/platform/queue/queue-readiness.indicator.ts),
  [`durable-jobs.md`](architecture/durable-jobs.md) and Amazing EKB import workers.

### `REL-02`. Transactional PostgreSQL outbox and BullMQ relay

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** transaction-required broker-neutral append, bounded
  JSON envelope, single-destination `SKIP LOCKED` claim, claim token/lease
  recovery, transient retry, terminal `BLOCKED`, stable BullMQ job ID, one-row
  redrive and bounded published retention.
- **What could be added:** only product composition: schema/destination,
  executable, consumer, durable idempotency and reconciliation.
- **Named consumer:** direct starter product adopter is absent, but the
  independent-Kit exception is satisfied. Amazing EKB generation state and Gift
  Bot atomic delivery intents confirm the same commit-to-work loss problem with
  product-owned solutions.
- **Failure model:** append outside transaction, DB commit-to-enqueue loss, crash
  after enqueue before `PUBLISHED`, expired/stale claimant, Redis loss, duplicate
  delivery, poison message and unsafe bulk redrive. No exactly-once guarantee.
- **Form:** inert-by-default Kit.
- **Required dependencies:** PostgreSQL transaction context and Core database —
  Available.
- **Conditional dependencies:** `REL-01` for BullMQ publisher; consumer-specific
  idempotency/reconciliation.
- **Blocked by:** none for Kit; adoption requires destination and consumer.
- **Unlocks:** atomic database-to-background-work handoff.
- **Priority:** P0 preservation; already implemented.
- **Reasons to defer / non-goals:** no fan-out/router, global event bus, ordering,
  product event catalog, consumer success tracking or exactly-once.
- **Evidence:** [`transactional-outbox.writer.ts`](../src/platform/outbox/transactional-outbox.writer.ts),
  [`outbox-relay.ts`](../src/platform/outbox/outbox-relay.ts),
  [`transactional-outbox.md`](runbooks/transactional-outbox.md) and integration
  recovery tests.

### `REL-03`. Bounded non-overlapping periodic maintenance runner

- **Entry kind:** Capability.
- **Catalog status:** Available on `stage`.
- **What already exists:** framework-free `PeriodicMaintenanceRunner` around an
  injected task with optional run-on-start, fixed delay, no overlap, abortable
  idle wait, stop admission, bounded drain and a safe typed observer.
- **What could be added:** only explicit product adoption around module-owned
  work; the Kit itself needs no scheduler, retry or persistence expansion.
- **Named consumer:** current `OutboxRelayRunner`, Gift Bot
  due-draw/sync/notification maintenance and Amazing EKB import dispatch/lease
  recovery. Outbox retention is only a prospective manual adopter; it is not a
  scheduled runtime today.
- **Failure model:** overlapping ticks duplicate work, drift/missed deadline,
  shutdown admits a new cycle, an unobserved rejection silently disables future
  ticks and multi-replica processes mistake an in-memory flag for distributed
  lock.
- **Form:** Kit.
- **Required dependencies:** `AbortSignal` lifecycle and Node timer primitives —
  Available.
- **Conditional dependencies:** product-owned durable due state, idempotency and
  fencing for crash recovery or multiple replicas.
- **Blocked by:** none for the Kit; adoption still needs a process owner and
  module-owned recovery policy.
- **Unlocks:** reusable product maintenance loops and a future explicit wiring
  of outbox retention without claiming that wiring already exists.
- **Priority:** P1 preservation; available on `stage`.
- **Reasons to defer / non-goals:** no persisted schedule table, cron parser,
  distributed singleton, retry classifier, queue or product task state.
- **Evidence:** [`periodic-maintenance-runner.ts`](../src/platform/maintenance/periodic-maintenance-runner.ts),
  its focused unit suite, the adopting
  [`outbox-relay-runner.ts`](../src/platform/outbox/outbox-relay-runner.ts),
  [adoption guide](architecture/periodic-maintenance.md) and the independent
  Gift Bot/Amazing EKB product-local loops.

### `REL-04`. Database-effect processed-message receipt

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `REL-02` publishes stable message ID and docs require
  an idempotent consumer; no receipt table/helper exists. Current products use
  natural durable operation/task/revision state.
- **What could be added:** narrow `(consumer, messageId)` unique receipt for a
  same-database effect, inserted atomically with that effect and governed by an
  explicit replay/retention policy.
- **Named consumer:** none currently lacks a natural product marker.
- **Failure model:** receipt before effect suppresses needed work, receipt after
  effect permits duplicate, retention re-enables replay, ID reused across
  consumers and an external side effect cannot be atomic with local receipt.
- **Form:** Kit only for same-database effects; external effects Product-specific.
- **Required dependencies:** stable consumer/message IDs, shared PostgreSQL
  transaction and replay/retention decision — Missing/Product-owned.
- **Conditional dependencies:** provider idempotency and reconciliation for
  external effects.
- **Blocked by:** first real consumer without natural idempotency state.
- **Unlocks:** simpler idempotent handling for a narrow message class.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no exactly-once claim, in-memory set or
  generic dedup table for all HTTP/webhook/job inputs.
- **Evidence:** idempotent-consumer boundary in
  [`transactional-outbox-adoption.md`](architecture/transactional-outbox-adoption.md).

### `REL-05`. HTTP command idempotency keys

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no `Idempotency-Key`, request hash, command receipt or
  response replay store.
- **What could be added:** one Product-specific mutation with actor-scoped key,
  canonical request fingerprint, pending/completed state, atomic result
  reference and bounded conflict/retention behavior.
- **Named consumer:** отсутствует; future payment/order is only a category-10
  candidate.
- **Failure model:** same key with different body, replay across actors/orgs,
  receipt without effect, effect without receipt, forever-pending record and
  cached response retaining secrets/PII.
- **Form:** Product-specific first; Reference after repeated command semantics.
- **Required dependencies:** named mutation, actor/organization scope,
  authoritative result and transaction/recovery policy — Missing.
- **Conditional dependencies:** `REL-02` only for subsequent async work;
  category 8 retention/audit.
- **Blocked by:** concrete command/payment/provider contract.
- **Unlocks:** safe client retry for that mutation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no global interceptor storing arbitrary HTTP
  responses and no conflation with Integration Inbox or message receipt.
- **Evidence:** absence in [`openapi.json`](api/openapi.json) and future
  `BIZ-01` boundary.

### `REL-06`. Generic distributed lock or lease service

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** Outbox owns private row claim/token; Amazing EKB
  import owns operation generation/lease/heartbeat; Gift Bot claims due draws in
  product state. Their fencing/ownership contracts differ.
- **What could be added:** only module-owned fenced transition beside the state
  it protects.
- **Named consumer:** none needs a global lock API.
- **Failure model:** expired owner continues writing, unlock by non-owner, clock
  skew, lease without fencing permits stale side effect and Redis-lock truth
  diverges from PostgreSQL product state.
- **Form:** Rejected generic; future Product-specific state machine.
- **Required dependencies:** none for rejected entry.
- **Conditional dependencies:** module-owned lock/claim is an alternative, not a
  shared service.
- **Blocked by:** no safe product-neutral contract.
- **Unlocks:** nothing independently.
- **Priority:** —.
- **Reasons to defer / non-goals:** no global Redis lock manager or advisory-lock
  service; lease belongs to the owning aggregate.
- **Evidence:** private claims in
  [`prisma-outbox.store.ts`](../src/platform/outbox/prisma-outbox.store.ts) and
  incompatible product implementations.

### `REL-07`. Universal retry, DLQ and workflow engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** Outbox owns only publication retry/block/redrive;
  BullMQ leaves attempts/backoff to feature; `INT-01` separately covers bounded
  outbound HTTP attempts.
- **What could be added:** only consumer-owned classifier, budget and recovery
  around named work.
- **Named consumer:** current flows prove incompatible policies: Outbox retries
  enqueue without exhaustion; Amazing imports have finite final attempt; Gift
  Bot honors provider retry delay while failed draws need operator retry.
- **Failure model:** non-idempotent retry duplicates effect, permanent error
  loops forever, one budget drops recoverable work, DLQ becomes false business
  truth and generic workflow hides product transitions.
- **Form:** Rejected generic; Product-specific state/Reference where needed.
- **Required dependencies:** none for rejected entry.
- **Conditional dependencies:** product-specific retry and recovery remain local.
- **Blocked by:** intrinsic incompatibility, not missing infrastructure.
- **Unlocks:** nothing as a generic module.
- **Priority:** —.
- **Reasons to defer / non-goals:** no universal job entity, saga engine, retry
  decorator, DLQ dashboard or generic workflow table.
- **Evidence:** differing policy in
  [`outbox-relay.ts`](../src/platform/outbox/outbox-relay.ts),
  [`durable-jobs.md`](architecture/durable-jobs.md) and named products.

### Сводка зависимостей

| Entry    | Required before implementation/adoption                     | Conditional                                   |
| -------- | ----------------------------------------------------------- | --------------------------------------------- |
| `REL-01` | Queue URL, BullMQ/ioredis and process lifecycle             | Product database; `REL-02` atomic handoff     |
| `REL-02` | PostgreSQL transaction context                              | `REL-01`; consumer idempotency/reconciliation |
| `REL-03` | Lifecycle, timer and safe observer                          | Durable due state/idempotency/fencing         |
| `REL-04` | Stable IDs, same DB transaction and replay/retention policy | Provider idempotency/reconciliation           |
| `REL-05` | Named command, actor scope, result and recovery policy      | `REL-02`, audit/retention                     |
| `REL-06` | Rejected global lock/lease                                  | Module-owned fenced state instead             |
| `REL-07` | Rejected universal retry/DLQ/workflow                       | Consumer-owned policies                       |

```text
Core lifecycle + separate queue Redis -> REL-01
PostgreSQL transaction               -> REL-02
REL-02 + REL-01 + product consumer   -> atomic queued delivery

Core lifecycle                       -> REL-03
REL-03 + product durable due state   -> recoverable periodic work
```

`REL-03` is Available on `stage` after PR #43 at merge commit `c010753`. It
invokes work but never provides distributed ownership by itself. `REL-04/05`
wait for consumers; `REL-06/07` record explicitly rejected generic
abstractions.

## 5. Интеграции и синхронизация

### Уже доступная foundation

- Core предоставляет typed config, lifecycle cancellation, structured logging,
  correlation, traces, PostgreSQL transactions и HTTP boundary.
- BullMQ Kit предоставляет отдельное queue Redis connection/readiness и
  standalone worker lifecycle, но не продуктовую очередь.
- Outbox Kit атомарно сохраняет сообщение вместе с PostgreSQL business
  transaction и публикует его через отдельный relay с at-least-once delivery.
- Auth/RBAC доступны для защищённых operator и integration endpoints.
- `INT-01` bounded outbound HTTP Kit доступен в `stage`;
  provider adapters, inbound webhook и connector modules в starter отсутствуют.

`INT-02` рассматривается здесь как lifecycle входящей интеграции. Если несколько
providers докажут одинаковую product-neutral persistence/recovery механику, её
выделенный Kit будет принадлежать категории 4 «Надёжность и фоновые процессы».

### `INT-01`. Bounded outbound HTTP attempt runner

- **Entry kind:** Capability.
- **Catalog status:** Available on `stage` after PR #44 at merge commit
  `a0c8e80`.
- **What already exists:** framework-free `FetchOutboundHttpAttemptTransport`
  для одной native-fetch попытки с обязательным caller signal, timeout через
  headers/body, explicit `ignore` или `buffer(maxBytes)`, strict
  `Content-Length`/incremental cap и typed outcomes/durations;
  `BoundedOutboundHttpRunner` добавляет один absolute deadline, attempts budget,
  abortable classifier-selected delay, required outer signal, synchronous
  outcome classifier и изолированный safe observer.
- **What could be added:** только explicit module-owned construction и provider
  adoption; Kit не требует global client, status defaults, persistence или
  runtime composition.
- **Named consumer:** подписанная cache revalidation доставка Amazing EKB и
  authenticated Threads follower snapshot остаются неизменёнными evidence
  scenarios, а не starter adopters. Их status, delay, credentials, loss и
  recovery policies остаются product-owned.
- **Failure model:** зависший upstream, network error, `408`, `429`, `5xx`,
  остановка процесса, неоднозначный timeout, retry storm и утечка URL, headers,
  body или secrets в diagnostics. Повтор неидемпотентной операции может создать
  дублирующий side effect.
- **Form:** inert-by-default Kit.
- **Required dependencies:** только Node 24 native `fetch`, timers и
  `AbortSignal` primitives — Available; Core imports и third-party dependencies
  отсутствуют.
- **Conditional dependencies:** adopter supplies the required outer
  `AbortSignal` and may wire optional safe observer telemetry in its own
  composition; global Core config/observability не требуются. Provider
  idempotency — Product-owned. Если работа должна переживать restart, consumer
  владеет durable state/runner; Outbox и BullMQ применяются только когда
  PostgreSQL business transaction должна атомарно создать последующую queued
  work.
- **Blocked by:** none for the Kit; adoption still requires module-owned
  provider configuration, classifier, outer lifecycle and durable recovery
  decision.
- **Unlocks:** `INT-04`, `INT-05`, `INT-08` и provider transports категории
  Communications.
- **Priority:** P1 preservation; available on `stage`.
- **Reasons to defer / non-goals:** не добавлять global `HttpService`,
  встроенную status/retry policy, автоматический retry любого запроса, provider
  SDK, persistence, circuit breaker или универсальную idempotency policy.
  Consumer решает, какие outcomes допускают повтор, какой delay использовать и
  приемлема ли потеря при process crash.
- **Evidence:** repository-local
  [`fetch-outbound-http-attempt-transport.ts`](../src/platform/http/outbound/fetch-outbound-http-attempt-transport.ts),
  [`bounded-outbound-http-runner.ts`](../src/platform/http/outbound/bounded-outbound-http-runner.ts),
  focused [transport](../test/unit/platform/http/outbound/fetch-outbound-http-attempt-transport.spec.ts)
  and [runner](../test/unit/platform/http/outbound/bounded-outbound-http-runner.spec.ts)
  unit suites, native-fetch [loopback integration](../test/integration/platform/http/outbound/fetch-outbound-http-attempt-transport.integration.spec.ts)
  and the [adoption guide](architecture/bounded-outbound-http.md). Amazing EKB
  and Threads remain unchanged external evidence only.

### `INT-02`. Durable Integration Inbox

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** PostgreSQL transaction boundary и отдельные outbox
  mechanics доступны, но outbound outbox не является inbound inbox.
- **What could be added:** durable receipt, provider event identity и payload
  fingerprint, deduplication, claim/recovery, retention, redrive и operator
  diagnostics без раскрытия payload.
- **Named consumer:** пока не выбран даже первый provider-specific inbound HTTP
  consumer; для общего Kit позднее потребуется второй независимый flow с
  совпадающим контрактом.
- **Failure model:** duplicate и out-of-order events, один event ID с разным
  payload, crash между acknowledge и business effect, partial processing и
  бесконтрольный replay.
- **Form:** первый provider владеет Reference; повторённая product-neutral
  persistence/recovery механика может стать Kit. Event types, payload validation
  и retention policy остаются у consumer.
- **Required dependencies:** PostgreSQL transactions — Available.
- **Conditional dependencies:** BullMQ — Available для асинхронной обработки.
- **Blocked by:** сначала первый provider-specific module-owned intake, затем
  второй независимый consumer с совпадающим контрактом
  `durable accept → deduplicate → process/recover` для извлечения общего Kit.
- **Unlocks:** общий intake только после доказанного повторения нескольких
  provider integrations.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не копировать outbox semantics во входящий
  поток и не придумывать event identity, ordering, replay или retention без
  provider contract.
- **Evidence:** входящего HTTP consumer в текущем starter и проверенных
  продуктовых сценариях пока нет.

### `INT-03`. Inbound provider webhooks

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** Core HTTP, Problem Details, logging и PostgreSQL;
  provider-specific webhook reference отсутствует.
- **What could be added:** raw-body boundary, signature/timestamp verification,
  replay protection, быстрый acknowledge, durable module-owned intake,
  deduplication и controlled replay.
- **Named consumer:** требуется конкретный payment, CRM, identity или другой
  provider с реальным event contract.
- **Failure model:** forged или replayed signature, duplicate, schema mismatch,
  slow acknowledge, accepted-but-unprocessed event и out-of-order delivery.
- **Form:** provider-specific Reference.
- **Required dependencies:** Core HTTP и provider-specific signature, event
  identity и acknowledgement semantics — provider contract Missing.
- **Conditional dependencies:** `INT-02`, только если он уже независимо извлечён;
  BullMQ для тяжёлой обработки; business audit для operator replay.
- **Blocked by:** выбранный provider и реальный callback scenario.
- **Unlocks:** payment callbacks, CRM events и delivery status updates.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать generic HMAC example. Первый
  webhook владеет receipt/dedup state внутри своего модуля; общий Inbox не
  является обязательной предварительной abstraction.
- **Evidence:** provider callback с реальным HTTP contract пока не найден.

### `INT-04`. Outbound webhook delivery

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** Outbox, BullMQ и `INT-01` Kits доступны в `stage`.
  Endpoint registry и внешний subscriber отсутствуют.
- **What could be added:** versioned event envelope, endpoint lifecycle,
  signing/secret rotation, delivery attempts, redrive и subscriber diagnostics.
- **Named consumer:** пока нет реального внешнего receiver и versioned event
  contract.
- **Failure model:** потеря события после commit, duplicate delivery,
  unavailable endpoint, SSRF, secret rotation и несовместимая event version.
- **Form:** Reference, собранный из существующих и будущих Kits.
- **Required dependencies:** versioned product event, durable handoff/delivery
  state, bounded provider-owned HTTP delivery contract, endpoint registry и
  signing policy — Product-owned.
- **Conditional dependencies:** Outbox — Available для transaction-coupled
  event; BullMQ — Available для queued-worker topology; `INT-01`, если его
  contract подходит без расширения; business audit для redrive и secret
  rotation.
- **Blocked by:** named receiver и первый versioned event.
- **Unlocks:** partner ecosystem и внешнюю automation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать глобальную event bus,
  fan-out framework, arbitrary URLs или exactly-once promise.
- **Evidence:** существующие Outbox/BullMQ contracts доказывают только delivery
  foundation, а не продуктовый subscriber contract; см.
  [`transactional-outbox-adoption.md`](architecture/transactional-outbox-adoption.md).

### `INT-05`. Provider reconciliation

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** Outbox recovery показывает технический recovery
  lifecycle, а Gift Bot — delivery recovery/compensation. Ни один из них не
  сравнивает authoritative product state с прочитанным provider state.
- **What could be added:** чтение известного external object, divergence
  classification, idempotent repair и bounded operator recovery.
- **Named consumer:** конкретный product-to-provider comparison flow пока не
  выбран.
- **Failure model:** lost callback, ambiguous outcome, state divergence,
  unavailable provider read и duplicate repair effect.
- **Form:** Reference pattern с Product-specific state mapping.
- **Required dependencies:** authoritative product state, stable external
  identity и provider read/repair contract — Product-owned.
- **Conditional dependencies:** `INT-01` для подходящего HTTP adapter; scheduler
  или BullMQ; `INT-03` при наличии push events.
- **Blocked by:** named consumer, конкретная модель внешнего состояния и
  допустимая repair operation.
- **Unlocks:** надёжный payment и connector recovery.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать универсальный diff/repair
  engine и не считать delivery retry полноценной reconciliation; ownership,
  conflict resolution и допустимые repairs принадлежат продукту.
- **Evidence:** Gift Bot подтверждает соседний recovery/compensation failure
  model, но не заявленный state-comparison contract.

### `INT-06`. Bulk import lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Auth/RBAC, BullMQ и worker lifecycle доступны;
  dataset operation state и универсальный import module отсутствуют.
- **What could be added:** durable operation status, progress, cancellation,
  partial-error report и safe rerun.
- **Named consumer:** Telegram material imports и Yandex place imports в
  Amazing EKB.
- **Failure model:** partial rows, oversized input, duplicate rerun, crash в
  середине обработки, authorization leak и format drift.
- **Form:** lifecycle как Reference; dataset, validation и mapping как
  Product-specific.
- **Required dependencies:** Auth/RBAC — Available; durable operation state —
  Product-owned.
- **Conditional dependencies:** BullMQ — Available для больших операций; Files
  для файлового варианта; Communications для completion message.
- **Blocked by:** выбранные dataset, format, access rules и partial-error
  semantics.
- **Unlocks:** bulk onboarding и первый bootstrap connector.
- **Priority:** P1 после выбора конкретного dataset.
- **Reasons to defer / non-goals:** не создавать universal ETL, generic import
  entity или обязательную очередь для небольших синхронных операций.
- **Evidence:** существующие Amazing EKB import workflows уже используются как
  named adoption source в [roadmap](roadmap.md#platform-adoption-candidates).

### `INT-07`. Bulk export lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** Auth/RBAC доступны; export dataset, snapshot и
  artifact lifecycle в starter отсутствуют.
- **What could be added:** consistent snapshot, asynchronous generation,
  protected download, expiration/deletion, audit и bounded operator recovery.
- **Named consumer:** конкретный export actor и dataset пока не выбраны.
- **Failure model:** inconsistent snapshot, authorization leak, oversized
  result, лишние PII, format drift, expired artifact и duplicate generation.
- **Form:** сначала Product-specific; повторяемый lifecycle может стать
  Reference.
- **Required dependencies:** Auth/RBAC — Available; dataset, snapshot,
  visibility, privacy и retention contracts — Product-owned.
- **Conditional dependencies:** durable operation state и BullMQ для больших
  exports; Files для artifact delivery; Communications для completion message.
- **Blocked by:** named consumer, dataset, format, access и retention policy.
- **Unlocks:** data portability и operator/customer reporting.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не считать import и export одной capability
  и не создавать generic reporting/ETL platform.
- **Evidence:** проверенные consumers подтверждают import, но не export contract.

### `INT-08`. Continuous connector sync

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** отдельные imports в продуктовых репозиториях дают
  evidence для polling jobs, но continuous bidirectional contract отсутствует.
- **What could be added:** durable cursor, incremental polling, push/pull
  coordination, rate-limit budget, conflict/deletion policy и reconciliation.
- **Named consumer:** конкретная continuous provider integration пока не
  выбрана.
- **Failure model:** cursor drift, lost page, conflicting edits,
  synchronization loop, неверное deletion propagation, rate limit и schema
  drift.
- **Form:** сначала Product-specific.
- **Required dependencies:** provider contract, durable sync state/cursor и
  connector-owned reconciliation semantics — Product-owned.
- **Conditional dependencies:** `INT-01` и `INT-05`, если их contracts подходят
  без расширения; scheduler/BullMQ и `INT-03` при наличии push events.
- **Blocked by:** provider, ownership, conflict resolution и deletion semantics.
- **Unlocks:** только конкретные product scenarios; само по себе не создаёт
  новую общую platform capability.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не создавать generic connector framework до
  подтверждённого повторения.
- **Evidence:** continuous provider flow с ownership/conflict contract пока не
  найден.

### Сводка зависимостей

| Capability | Required before implementation                                                            | Conditional                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `INT-01`   | Node 24 native `fetch`, timers и `AbortSignal` primitives                                 | Outer signal; optional safe observer; provider idempotency/durable state; conditional Outbox/BullMQ |
| `INT-02`   | PostgreSQL transactions                                                                   | BullMQ                                                                                              |
| `INT-03`   | Конкретный provider contract и module-owned intake                                        | Извлечённый `INT-02`, BullMQ, audit                                                                 |
| `INT-04`   | Versioned event, durable delivery state, bounded HTTP, endpoint registry и signing policy | Outbox, BullMQ, `INT-01`, audit                                                                     |
| `INT-05`   | Authoritative product state и provider read/repair contract                               | `INT-01`, scheduler/BullMQ, `INT-03`                                                                |
| `INT-06`   | Auth/RBAC, dataset contract и durable operation state                                     | BullMQ, Files, Communications                                                                       |
| `INT-07`   | Auth/RBAC, dataset snapshot, access и retention contracts                                 | Durable operation state, BullMQ, Files, Communications                                              |
| `INT-08`   | Provider contract, durable cursor и reconciliation semantics                              | `INT-01`, `INT-05`, scheduler/BullMQ, `INT-03`                                                      |

Порядок строк не является обязательным порядком реализации. `INT-01` Available
в `stage`; `INT-06` имеет
реальный consumer, но сохраняет product-owned dataset и policy. `INT-05`
остаётся deferred до настоящего state-comparison consumer.

## 6. Коммуникации

### Граница категории

Auth already sends three fixed transactional ceremonies, but it owns their
token eligibility/content/recovery. That does not create a notification
platform. Communications starts when a product creates a versioned recipient
intent and needs delivery/read/retry semantics across business events.

Gift Bot is the strongest runtime evidence for a durable notification ledger;
DARTS is an approved docs-only consumer for in-app + email notifications. The
first extraction must remain one vertical: no global event bus, templates,
preferences or campaigns before their own consumers.

### `COM-01`. Auth-owned transactional ceremony mail

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** `AuthMailDeliveryPort` and bounded Nodemailer adapter
  send fixed verification, reset and invitation messages. SMTP is selected only
  with the owning auth mode, not readiness; account/token commit precedes
  best-effort send; Mailpit is local evidence.
- **What could be added:** nothing generic for auth. Another provider can be an
  auth-owned adapter without expanding content into Communications.
- **Named consumer:** `react-starter` self-service lifecycle, invitation and
  administrator recovery.
- **Failure model:** SMTP/DNS/TLS/credential outage after commit, ambiguous
  timeout, duplicate resend and provider acceptance without inbox delivery.
  Self-service remains non-enumerating; admin reports `delivered|failed`.
- **Form:** default-disabled Reference owned by Identity/Auth.
- **Required dependencies:** `ID-03` or `ID-05`, token state, app URL/CORS and
  SMTP configuration — Available/Environment-owned.
- **Conditional dependencies:** `COM-02` only if a product replaces current
  user-triggered recovery with durable delivery.
- **Blocked by:** none in repository; production adoption needs SMTP/DNS/secrets.
- **Unlocks:** mailbox verification/recovery/onboarding, not generic messages.
- **Priority:** —; already Available.
- **Reasons to defer / non-goals:** no templates, preferences, inbox, campaigns,
  delivery ledger or SMTP readiness; auth token/content policy stays in auth.
- **Evidence:** [`auth-mail-delivery.port.ts`](../src/modules/auth/application/auth-mail-delivery.port.ts),
  [`nodemailer-auth-mail.adapter.ts`](../src/modules/auth/infrastructure/nodemailer-auth-mail.adapter.ts)
  and [`self-service-account-lifecycle.md`](runbooks/self-service-account-lifecycle.md).

### `COM-02`. Product transactional notification intent and durable delivery

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter has transactions, Outbox and BullMQ but no
  notification semantics. Gift Bot stores durable draw-notification intents
  with an immutable content snapshot plus mutable claim/recovery/attempt state
  and next availability. Its channel-health alerts instead have a separate
  mutable `active/resolved/notified` lifecycle and operator visibility; they do
  not implement the draw-delivery claim/attempt contract.
- **What could be added:** one product-owned vertical atomically creating a
  versioned intent with recipient, channel, rendered content snapshot, status,
  attempts, next attempt, safe failure class and supersession key; runner owns
  claim/recovery/redrive, while product owns event criticality.
- **Named consumer:** Gift Bot winner/team/channel-health notifications; DARTS
  changes to requests/files/bookings/payments/leads as an approved but not yet
  implemented second consumer.
- **Failure model:** intent lost after business commit, duplicate send, crash
  after provider side effect, stale message after newer revision, blocked
  recipient, rate limit/outage, infinite retry, PII in payload/diagnostics and
  operator status diverging from reality.
- **Form:** Product-specific Reference first; repeated persistence/claim/recovery
  mechanics may later become inert Kit.
- **Required dependencies:** versioned product event, recipient/visibility and
  authoritative business transaction — Product-owned; PostgreSQL — Available.
- **Conditional dependencies:** Outbox/BullMQ for selected topology, provider
  adapter and `REL-03` or feature-owned scheduler.
- **Blocked by:** DARTS event catalog and delivery criticality remain open; any
  other concrete vertical may start without waiting for DARTS.
- **Unlocks:** durable email, `COM-05`, operator redrive and delivery reporting.
- **Priority:** P1 inside Communications; not automatic roadmap selection.
- **Reasons to defer / non-goals:** no global bus, campaign engine, arbitrary
  fan-out, exactly-once or universal table before module-owned implementation.
- **Evidence:** external Gift Bot `draw-notification-service.ts`,
  `draw-repository.ts` and `channel-health-alert-service.ts`; DARTS FR-023/024;
  starter Outbox adoption guide.

### `COM-03`. Bounded product-email transport

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** bounded SMTP is private to auth ceremony types; its
  port is not an arbitrary notification envelope.
- **What could be added:** inert single-attempt SMTP/provider adapter with
  explicit sender/recipient/subject/text/html, deadline, TLS policy and safe
  outcome classification. Persistence/retry/templates remain outside.
- **Named consumer:** DARTS requires product email, but only a contract exists;
  auth `COM-01` does not require extraction.
- **Failure model:** DNS/TLS/auth failure, rate limit, ambiguous accepted timeout,
  retry duplicate, sender-reputation misconfiguration and `accepted` confused
  with mailbox delivery.
- **Form:** provider Kit after a non-auth implementation proves the boundary.
- **Required dependencies:** Core config/lifecycle/logging and selected SMTP or
  provider contract — Available/Product-owned.
- **Conditional dependencies:** `COM-02`, `INT-03` bounce/complaint callback and
  SPF/DKIM/DMARC/secrets environment.
- **Blocked by:** first implemented non-auth mail flow.
- **Unlocks:** email channel for `COM-02`.
- **Priority:** P2.
- **Reasons to defer / non-goals:** do not export Auth port, put retry/templates
  in transport or make SMTP an API readiness dependency.
- **Evidence:** current auth adapter and DARTS `scope-v1.md` external contract.

### `COM-04`. Typed notification templates and content versioning

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** auth has fixed messages; Gift Bot has product-owned
  pure renderers. No shared template/locale/version registry exists.
- **What could be added:** code-owned typed IDs, allowlisted variables,
  deterministic escaped text/html, locale fallback, snapshot tests and explicit
  content version; queued intent stores rendered snapshot or template version.
- **Named consumer:** DARTS needs events/content but the exact catalog is still
  proposed; current auth/Gift Bot renderers need no common abstraction.
- **Failure model:** missing variable, event/template drift, HTML/link injection,
  wrong locale fallback, secret in preview/log and old queued message changing
  under a new template.
- **Form:** Reference first; pure renderer Kit after repetition.
- **Required dependencies:** stable product message/event and content contract —
  Product-owned.
- **Conditional dependencies:** `COM-02` when a queued intent stores the
  rendered snapshot or template version; localization; operator
  editing/audit/approval only after a real mutable-template need.
- **Blocked by:** implemented consumer with multiple versioned templates/locales.
- **Unlocks:** consistent multi-channel content and preview.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no WYSIWYG/CMS, database editor,
  Liquid-like language or marketing personalization.
- **Evidence:** auth adapter, Gift Bot renderers and DARTS product brief.

### `COM-05`. In-app notification inbox and read state

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** no in-app notification/read state in starter. DARTS
  confirms an in-cabinet channel, while its final event list remains proposed.
- **What could be added:** recipient-owned paginated list, bounded unread count,
  idempotent mark-read, immutable safe summary, authorized deep link and explicit
  retention. A product may create the row directly with its business event or
  project it from an existing multi-channel intent ledger.
- **Named consumer:** DARTS v1, approved product contract without runtime.
- **Failure model:** reading another user's item, unread-count drift, duplicate
  row, link to deleted/inaccessible aggregate, stale content after role removal
  and unbounded accumulation.
- **Form:** DARTS Product-specific first; possible Reference after repetition.
- **Required dependencies:** `ID-01`, named product event, recipient/visibility,
  durable inbox row and retention policy — Available/Product-owned.
- **Conditional dependencies:** `COM-02` only when an existing multi-channel
  intent ledger is deliberately reused; polling is sufficient initially, while
  SSE/WebSocket and background push are not prerequisites.
- **Blocked by:** final DARTS event catalog, visibility and retention.
- **Unlocks:** confirmed in-app channel and later `COM-06`.
- **Priority:** P1 after product blockers.
- **Reasons to defer / non-goals:** no Integration Inbox, comments/activity feed,
  business audit or realtime platform.
- **Evidence:** DARTS FR-023/024 and `scope-v1.md` external evidence.

### `COM-06`. Notification preferences and channel routing

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no preferences. DARTS confirms two channels but not
  user opt-out; auth ceremonies intentionally ignore product preferences.
- **What could be added:** product-owned event/channel matrix with mandatory
  classifications, safe defaults, revision and actor/time metadata.
- **Named consumer:** no confirmed preference consumer.
- **Failure model:** critical security/payment/service message suppressed,
  default changes retroactively, concurrent update lost, destination stale and
  unsubscribe reveals account existence.
- **Form:** Product-specific.
- **Required dependencies:** stable product message catalog, verified
  destinations and mandatory-versus-optional policy — Product-owned.
- **Conditional dependencies:** `COM-02` when preferences route a durable
  multi-channel intent; category 8 consent/legal basis; signed unsubscribe for
  eligible email classes.
- **Blocked by:** product/regulatory mandatory-versus-optional decision.
- **Unlocks:** user-controlled non-critical channel routing.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no universal matrix and no preferences for
  verification, recovery, MFA or legally mandatory messages by default.
- **Evidence:** contract absent in starter and verified products.

### `COM-07`. Scheduled digests

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no digest lifecycle.
- **What could be added:** product aggregation cursor/window, timezone/cutoff,
  deterministic ordering, idempotent issue key and content-size budget.
- **Named consumer:** none; DARTS period reminder is a single event, not a digest.
- **Failure model:** missed/duplicate events at window edge, DST drift, late
  events, crash replay and unbounded payload.
- **Form:** Product-specific.
- **Required dependencies:** named source/event stream, cadence/window,
  aggregation semantics, recipient and delivery policy — Product-owned.
- **Conditional dependencies:** `COM-02` for durable delivery, `COM-04` for
  typed content, `REL-03` and `COM-06`.
- **Blocked by:** named cadence and aggregation semantics.
- **Unlocks:** only concrete summary scenarios.
- **Priority:** P3.
- **Reasons to defer / non-goals:** no universal cron newsletter and no
  conflation of retry batching with digest.
- **Evidence:** consumer absent.

### `COM-08`. SMS and web/mobile push provider references

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no provider SDK, phone/device-token lifecycle or
  consumer. Telegram Gift Bot is a product integration, not generic push.
- **What could be added:** one channel/provider Reference at a time with outcome
  mapping, cost/rate budget and destination lifecycle.
- **Named consumer:** none; DARTS chooses in-app plus email.
- **Failure model:** reassigned phone, SMS abuse/cost, stale/shared device token,
  sensitive lock-screen payload, provider outage/delay and terminal platform
  errors.
- **Form:** provider-specific Reference.
- **Required dependencies:** named consumer, verified destination and provider
  secrets/contracts — Missing/Product-owned.
- **Conditional dependencies:** `COM-02` for product transactional delivery,
  `INT-01`, `INT-03`, and `ID-09` only if SMS is deliberately chosen as a
  factor.
- **Blocked by:** selected channel/provider and real user flow.
- **Unlocks:** one additional channel, not a generic framework.
- **Priority:** P3.
- **Reasons to defer / non-goals:** no premature SMS/push common interface, no
  SMS MFA default and no transfer of Telegram semantics.
- **Evidence:** consumer/dependencies absent in verified repositories.

### Сводка зависимостей

| Entry    | Required before implementation/adoption                        | Conditional                                             |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| `COM-01` | `ID-03/05`, token state, app origin/CORS and SMTP              | `COM-02` only for stronger delivery                     |
| `COM-02` | Product event, recipient/visibility and business transaction   | Outbox/BullMQ, provider, maintenance runner             |
| `COM-03` | Non-auth mail consumer and provider contract                   | `COM-02`, callbacks and hosted mail controls            |
| `COM-04` | Stable notification event/content contract                     | `COM-02`, locale and later editing/approval             |
| `COM-05` | Identity, product event, recipient/visibility, inbox retention | `COM-02` ledger reuse; polling first; realtime optional |
| `COM-06` | Stable message catalog, destinations and mandatory policy      | `COM-02`, consent/unsubscribe                           |
| `COM-07` | Source stream, cadence/window, aggregation and delivery policy | `COM-02/04/06`, periodic runner                         |
| `COM-08` | Named flow, destination lifecycle and provider                 | `COM-02`, HTTP/callback adapters and factor policy      |

Business module owns whether/why a message exists; Communications owns selected
recipient/channel delivery. In-app Inbox is not Integration Inbox. `COM-02` is
the strongest new P1; `COM-05` is P1 only after DARTS visibility/retention rules.

## 7. Данные, файлы и discovery

### Граница владения

Auth владеет login identity и своим SMTP ceremony; product profile относится к
этой категории, но не расширяет Auth `User`. Product/data owner задаёт data
class, association, visibility, content limits и lifecycle requirements.
`GOV-03` владеет consent evidence, `GOV-05` — subject-erasure plan, а `GOV-06`
— retention, legal holds и purge orchestration. Data module и storage adapter
исполняют validation, physical storage/deletion и reconciliation, не становясь
global service. Категория 5 владеет EDO/provider sync и import/export operation,
а здесь остаётся только storage/artifact mechanics.

Starter пока не содержит uploads, object storage, product profiles или external
search index. Amazing EKB подтверждает implemented local-media и module-local
search flows. DARTS подтверждает approved product contract для profiles и
documents, но не реализованный runtime. Само наличие file consumer не является
триггером для S3.

### `DATA-01`. Product profile отдельно от auth identity

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter `User` содержит только auth-owned поля, а
  React consumer работает с account email. Gift Bot хранит Telegram username и
  display name как product snapshot. DARTS описывает профиль риелтора и
  verification, но точные PII, legal basis, access и retention ещё не определены.
- **What could be added:** отдельный product aggregate по стабильному user ID,
  typed fields, revision/ETag, owner/operator projections с redaction и current
  eligibility projection; без добавления бизнес-полей в Auth `User`. `WF-03`
  владеет submission snapshot, reviewer decision/history и activation effect,
  а profile лишь отражает результат по явному contract.
- **Named consumer:** портал DARTS v1 — approved docs-only contract, не
  реализованный runtime.
- **Failure model:** PII disclosure, mass assignment, lost update, stale
  verification, доступ после deauthorization, конфликт erasure/retention и
  смешение account status с professional status.
- **Form:** Product-specific Reference.
- **Required dependencies:** `ID-01`, точная field schema, access matrix и
  product privacy/retention decisions — Available/Product-owned.
- **Conditional dependencies:** `ID-04` только для operator/retirement
  integration; category 9 verification, `DATA-03` для supporting documents,
  `GOV-02/03/05/06` по принятому audit/consent/erasure/retention contract.
- **Blocked by:** approved profile fields, legal basis/consent, retention и
  owner/operator access matrix.
- **Unlocks:** DARTS onboarding и управляемый professional profile.
- **Priority:** P1 после закрытия product/privacy blockers.
- **Reasons to defer / non-goals:** no dynamic key-value profile, generic KYC,
  identity proofing или перенос product fields/verification в Auth.
- **Evidence:** `prisma/schema.prisma`; DARTS `scope-v1.md` и profile/verification
  requirements — docs-only external contract.

### `DATA-02`. Module-owned bounded cover-image lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** uploads в starter отсутствуют. Amazing EKB runtime
  реализует три module-owned cover flows для places, categories и collections:
  лимит 5 MB, JPEG/PNG/WebP, magic-byte validation, bounded buffer, safe relative
  path, MIME metadata, `UPLOADS_DIR`, per-module storage ports, visibility,
  database swap, rollback и cleanup.
- **What could be added:** одна optional Reference для одного named cover-image
  consumer с local adapter; переиспользовать только bounded validation, safe-path
  и rollback mechanics, сохраняя association и policy в business module.
- **Named consumer:** Amazing EKB — implemented runtime; текущему one-VPS
  deployment достаточно local persistent storage.
- **Failure model:** oversized allocation, spoofed MIME, path traversal,
  file-write/database split, orphan или missing object, failed replacement
  rollback, unwritable volume и непроверенное host recovery.
- **Form:** Product-specific Reference, не Core.
- **Required dependencies:** named aggregate, RBAC/visibility, content policy,
  metadata transaction и durable writable directory — Product-owned.
- **Conditional dependencies:** `DATA-04` только после topology trigger;
  decode/resize/malware scan только по подтверждённой policy; `GOV-05/06` для
  subject deletion, retention или legal hold.
- **Blocked by:** для текущего Amazing EKB consumer технического blocker нет;
  включение Reference в starter требует отдельного roadmap decision. Второй
  consumer нужен только для promotion общих mechanics в Kit.
- **Unlocks:** provider-port seam и `DATA-05` для конкретного media flow.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no arbitrary-file API, global storage
  service, generic attachment entity, S3/MinIO/CDN по умолчанию.
- **Evidence:** `docs/roadmap.md` direction-gated files/media track; Amazing EKB
  place/category/collection media flows — audited implemented runtime.

### `DATA-03`. Private documents and business attachments

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** runtime в starter и DARTS отсутствует. DARTS
  подтверждает upload, storage и exchange документов, привязанных к
  profile/request/lead, и один approved initial-offer EDO flow.
- **What could be added:** product-owned private document aggregate, explicit
  association, immutable metadata/hash, bounded streaming upload, authorization
  на каждом read, version/delete state и recovery contract. Quarantine появляется
  только после отдельного решения о content risk.
- **Named consumer:** портал DARTS v1 — approved docs-only contract, не
  реализованный runtime.
- **Failure model:** authorization bypass, malicious/oversized/spoofed content,
  partial upload/commit, orphan или missing bytes, stale signed URL, deletion при
  active retention/legal hold и duplicate portal/provider document.
- **Form:** Product-specific Reference.
- **Required dependencies:** identity/RBAC, business relation, access/content/
  retention policy и consumer-owned storage port — Missing/Product-owned.
- **Conditional dependencies:** `DATA-04`, scanner/quarantine, `GOV-02/03/05/06`
  по audit/consent/erasure/retention policy и category 5 EDO
  webhook/reconciliation.
- **Blocked by:** exact access matrix, content types/limits, retention/legal
  rules и chosen storage topology.
- **Unlocks:** DARTS request/lead document exchange и optional storage для
  file-backed integration/privacy artifacts; `INT-06/07` не зависят от private
  document aggregate.
- **Priority:** P1 после product, privacy и storage decisions.
- **Reasons to defer / non-goals:** no generic attachment table, arbitrary
  bucket keys, document editor/archive, own signature/key/certificate stack или
  multi-EDO abstraction.
- **Evidence:** DARTS `FR-016`, `FR-018`, `FR-025` и `FR-026` — confirmed,
  `FR-019` — proposed; `FR-008`, `FR-020` и `docs/product/edo-signing-v1.md`
  описывают approved EDO scope. Legal document semantics принадлежат EDO
  product module; эта карточка покрывает только storage mechanics.

### `DATA-04`. Local/object-storage provider adapter

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** application storage adapter в starter отсутствует.
  `aws` CLI в PostgreSQL backup runbook — operator-owned backup transport, а не
  app S3 capability. Amazing EKB module ports подтверждают provider seam, но
  current local storage достаточно.
- **What could be added:** inert provider adapter только за consumer-owned port:
  bounded streaming `put/open/head/delete`, safe key construction, timeouts,
  typed errors и recovery notes. Presigned upload/download — только при explicit
  direct-browser contract.
- **Named consumer:** none now. Amazing EKB становится consumer после replicas,
  ephemeral disk, off-host recovery, CDN или direct-upload trigger; DARTS — после
  выбора topology.
- **Failure model:** bad credentials/bucket/region, ambiguous write result,
  incomplete multipart upload, orphan, key collision/traversal, stale presigned
  URL, versioned delete и provider consistency behavior.
- **Form:** inert provider Kit, используемый только через module port.
- **Required dependencies:** named consumer-owned storage port, selected
  provider, deployment topology trigger и recovery contract —
  Missing/Product-owned.
- **Conditional dependencies:** MinIO только как acceptance environment;
  provider-specific CDN/presigned URL и observability.
- **Blocked by:** topology trigger, provider choice и restore/reconciliation
  decisions.
- **Unlocks:** смену local storage на конкретный object provider без переноса
  product policy в adapter.
- **Priority:** P2 после реального topology trigger.
- **Reasons to defer / non-goals:** no default SDK/MinIO dependency, readiness
  probe, global `StorageService`, arbitrary caller-owned keys или S3 из одного
  факта наличия файлов.
- **Evidence:** `docs/roadmap.md` direction-gated files/media track;
  `docs/runbooks/postgres-backup-restore.md` подтверждает только operator-owned
  database backup transport.

### `DATA-05`. Stored-object integrity, reconciliation and recovery

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Amazing EKB cover flows имеют rollback и cleanup, но
  filesystem и database не атомарны. Starter backup contract восстанавливает
  PostgreSQL, но не product file bytes.
- **What could be added:** product-owned report/dry-run, который сравнивает
  authoritative metadata с object inventory, классифицирует missing/orphan/
  corrupt objects, предлагает race-safe repair и связывает metadata plus bytes
  backup/restore. Destructive auto-cleanup требует отдельного разрешения.
- **Named consumer:** Amazing EKB — три implemented cover flows; DARTS станет
  consumer только после document runtime.
- **Failure model:** database restored without objects, missing live object, PII
  orphan, checksum mismatch, scan race deleting a new reference, unbounded scan
  и destructive cleanup без review.
- **Form:** operations Reference; Kit только после повторения контракта.
- **Required dependencies:** authoritative metadata, list/head/checksum
  capability, ownership и retention policy — Product-owned.
- **Conditional dependencies:** `REL-03` lease/scheduler, `GOV-02/05/06` для
  audit/erasure/retention/legal hold и `DATA-04` provider inventory.
- **Blocked by:** declared recovery gap, object-inventory contract и explicit
  repair/deletion policy.
- **Unlocks:** проверяемый media/document recovery и безопасную orphan cleanup.
- **Priority:** P2; повышается после private documents или independent object
  backup.
- **Reasons to defer / non-goals:** no auto-delete on first scan, global asset
  registry или предположение, что database backup включает file bytes.
- **Evidence:** `docs/runbooks/postgres-backup-restore.md`; Amazing EKB media
  rollback/cleanup — audited implemented runtime.

### `DATA-06`. Generic product catalog/taxonomy engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** Amazing EKB product owns categories, places,
  collections, materials, favorites, publication, ordering и cache semantics;
  starter не содержит catalog aggregate.
- **What could be added:** только named product module; небольшие mechanics можно
  извлекать после повторения независимыми consumers.
- **Named consumer:** Amazing EKB, но его catalog semantics остаются
  product-specific и не подтверждают starter abstraction.
- **Failure model:** generic entity/field/status model стирает ownership,
  visibility, ordering, taxonomy, moderation, cascade и authorization rules.
- **Form:** Rejected generic capability; a concrete catalog remains
  Product-specific.
- **Required dependencies:** none for the rejected entry.
- **Conditional dependencies:** a separate product module may use `DATA-02`,
  module-local query/indexes, import and cache capabilities.
- **Blocked by:** generic capability is rejected.
- **Unlocks:** ничего на уровне starter; product module unlocks только свой flow.
- **Priority:** —.
- **Reasons to defer / non-goals:** no generic CRUD/catalog/taxonomy/content
  engine и no configurable entity platform.
- **Evidence:** `docs/roadmap.md` оставляет Amazing EKB product entities в
  product repository.

### `DATA-07`. Generic list/filter/search abstraction

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** account administration имеет bounded `page/pageSize`,
  state/email filters и stable order. Amazing EKB использует собственные catalog
  filters и PostgreSQL contains queries; query contracts различаются.
- **What could be added:** только module-local indexes, query objects и pagination
  после измеренного workload; не shared controller/repository/query builder.
- **Named consumer:** React account administration и Amazing EKB catalog, каждый
  со своим реализованным contract.
- **Failure model:** unbounded contains/count, unstable offset pagination,
  hidden/retired data disclosure, implicit filters и abstraction, мешающая
  ranking/index evolution.
- **Form:** Rejected generic capability; concrete queries remain Reference or
  Product-specific.
- **Required dependencies:** none for the rejected entry.
- **Conditional dependencies:** a separate module-owned query contract needs
  schema, visibility, ranking and pagination semantics; PostgreSQL indexes, FTS
  or trigram follow query-plan/latency evidence.
- **Blocked by:** generic abstraction is rejected.
- **Unlocks:** ничего; сохраняет явную границу для `DATA-08`.
- **Priority:** —.
- **Reasons to defer / non-goals:** no generic repository/controller/service,
  global pagination helper или universal filtering DSL.
- **Evidence:** `src/modules/auth/infrastructure/prisma-auth.repository.ts`;
  `src/modules/auth/presentation/admin-account.dto.ts`; Amazing EKB catalog
  queries — audited implemented runtime.

### `DATA-08`. External search projection and index lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** external index в starter отсутствует. Amazing EKB
  имеет реальный catalog, но текущий PostgreSQL search достаточен; DARTS не имеет
  approved search requirement.
- **What could be added:** versioned product search document,
  authorization-safe projection, durable update handoff, provider adapter,
  index alias/version, full rebuild/reconciliation и explicit degraded policy.
- **Named consumer:** none now. Amazing EKB становится consumer только после
  measured ranking, typo, geo, multilingual или scale trigger.
- **Failure model:** database/index dual-write drift, stale/deleted result,
  authorization leak, partial reindex, provider outage, analyzer/schema mismatch
  и unstable pagination.
- **Form:** Product-specific projection plus provider-specific adapter.
- **Required dependencies:** approved searchable fields, ranking, visibility,
  freshness SLO и provider need — Missing/Product-owned.
- **Conditional dependencies:** `REL-01/02` или BullMQ для update/rebuild,
  `INT-05` reconciliation и chosen search provider.
- **Blocked by:** measured PostgreSQL limitation, provider choice, availability
  target и fallback behavior.
- **Unlocks:** advanced discovery для одного product-owned search contract.
- **Priority:** P3.
- **Reasons to defer / non-goals:** no automatic Prisma indexing, global search
  service или assumption, что наличие catalog само требует external engine.
- **Evidence:** `docs/roadmap.md` deferred/exploratory search candidates; no
  external-search dependency or runtime in verified repositories.

### Сводка зависимостей

| Entry     | Required before implementation/adoption                           | Conditional                                         |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| `DATA-01` | `ID-01`, profile schema/access и product privacy decisions        | `ID-04`, verification, `DATA-03`, `GOV-02/03/05/06` |
| `DATA-02` | Aggregate, file/visibility policy, metadata transaction, volume   | `DATA-04`, decode/resize/scan                       |
| `DATA-03` | ID/RBAC, business relation, access/content/retention, module port | `DATA-04`, scan, category 5 EDO, category 8         |
| `DATA-04` | Named storage port, provider/topology trigger и recovery contract | MinIO acceptance, CDN/presigned                     |
| `DATA-05` | Metadata/object inventory, ownership и retention policy           | `REL-03`, `DATA-04`, `GOV-02/05/06`                 |
| `DATA-06` | Generic catalog rejected; concrete product domain only            | Product-owned media/query/import/cache              |
| `DATA-07` | Generic query abstraction rejected; module query contract only    | Module indexes/FTS/trigram                          |
| `DATA-08` | Search document/ranking/visibility/freshness и measured need      | `REL-01/02`, `INT-05`, provider                     |

Порядок adoption остаётся consumer-first:

```text
ID-01 + product/privacy policy -> DATA-01
Named aggregate + file policy  -> DATA-02 or DATA-03
Named storage port + topology trigger -> DATA-04
DATA-02/03 + inventory policy  -> DATA-05
Product query contract         -> module-local search
Measured external-search need  -> DATA-08
```

`DATA-01` и `DATA-03` — новые P1 candidates, но оба заблокированы product/privacy
решениями. `DATA-02` runtime-proven, однако его extraction пока P2. `DATA-04` не
является обязательной dependency: durable local storage остаётся валидным
deployment choice. Generic abstractions `DATA-06/07` отклонены.

## 8. Operations, governance и privacy

### Граница категории

Category 8 владеет durable business accountability и product privacy policy:
business action history, consent evidence, subject export, erasure/anonymization
и retention. Она не превращает технические логи в legal evidence и не выбирает
одинаковую privacy policy для разных продуктов. `GOV-01` включён ниже только как
adjacent existing comparator: его implementation owner — Auth/Platform logging
в категориях 1/2, не governance runtime.

Текущий auth audit — security telemetry, а не durable business audit. Account
retirement удаляет auth-owned credentials и tombstones identity, но сохраняет
user ID и product foreign keys; это не full erasure. Технические сроки Loki,
Tempo, Outbox и auth tokens не становятся product-data retention defaults.

### `GOV-01`. Adjacent auth security audit telemetry comparator

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** finite `AuthAuditAction`, reviewed
  `action/outcome/reasonCode` tuples, value-free identifiers, non-throwing
  `AuthAuditLogger`, process-local dropped-event counter и Pino output с
  request/trace correlation. Локальные Loki/Tempo имеют retention `168h`.
- **What could be added:** только environment-owned centralized sink, retention
  и alerts, если production contract этого требует.
- **Named consumer:** security-sensitive login, session, password и administrator
  operations текущего auth-модуля.
- **Failure model:** invalid event отбрасывается с process-local counter, crash
  или stdout pipeline outage теряет запись, retention удаляет историю, malformed
  identifier не проходит validation. Transactional/durable guarantee нет.
- **Form:** Core security observability owned by Auth/Platform logging; recorded
  here as an adjacent comparator, not a category-8-owned runtime.
- **Required dependencies:** `AuthAuditPort`, structured logging и stdout sink
  — Available.
- **Conditional dependencies:** hosted log storage, access control, retention и
  alerting — Environment-owned.
- **Blocked by:** repository blockers отсутствуют.
- **Unlocks:** security incident investigation; не durable business history или
  compliance proof.
- **Priority:** —; capability уже Available.
- **Reasons to defer / non-goals:** не называть это business audit, event store
  или legal evidence; не добавлять PII, before/after snapshots и arbitrary event
  codes.
- **Evidence:**
  [`auth-audit.port.ts`](../src/modules/auth/application/auth-audit.port.ts),
  [`auth-audit.logger.ts`](../src/platform/logging/auth-audit.logger.ts),
  [`auth-audit.e2e.spec.ts`](../test/e2e/logging/auth-audit.e2e.spec.ts) и
  [`errors-logging-observability.md`](architecture/errors-logging-observability.md).

### `GOV-02`. Module-owned durable business action history

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** `approval-requests` атомарно сохраняет terminal
  decision, actor и timestamp; Amazing EKB атомарно добавляет
  `PlaceStatusTransition`; Gift Bot сохраняет reasoned `reroll_operations`,
  exclusions и versioned prize-place changes. Общего starter contract и query
  API нет.
- **What could be added:** maintained Reference pattern: module-owned
  append-only schema, запись в одной transaction с business mutation, finite
  event vocabulary, authorized cursor query и явная retention/visibility policy.
- **Named consumer:** Amazing EKB place moderation history, Gift Bot
  post-publication reroll accountability и текущий `approval-requests`
  decision record.
- **Failure model:** business mutation без истории при раздельных commits,
  duplicate после retry, mutable/tampered history, actor потерян после account
  lifecycle change, sensitive diff раскрыт API или query/retention не ограничены.
- **Form:** Reference pattern; vocabulary, payload, visibility и retention
  остаются Product-specific.
- **Required dependencies:** PostgreSQL transactions — Available; stable
  actor/target identifiers, finite module event schema, authorization и
  retention — Product-owned.
- **Conditional dependencies:** `REL-02` только для внешнего
  archive/projection; WORM/signing только при отдельном control; category 7 для
  protected artifacts.
- **Blocked by:** runtime extraction общего store запрещена до совпадения
  storage/query contract у двух in-starter consumers. Product modules могут
  реализовать module-owned history независимо.
- **Unlocks:** change history, reasoned support actions, governance reports и
  privacy-operation evidence.
- **Priority:** P1; повторение подтверждено тремя независимыми verticals.
- **Reasons to defer / non-goals:** не делать global `audit_events` с arbitrary
  JSON, raw before/after по умолчанию, замену access logs/traces/`GOV-01` или
  аудит каждого read без sensitive-read requirement.
- **Evidence:** [Prisma schema](../prisma/schema.prisma),
  [approval aggregate](../src/modules/approval-requests/domain/approval-request.ts)
  и [product capability triggers](roadmap.md#product-capability-triggers);
  Amazing EKB repository `prisma/schema.prisma` и
  `src/modules/places/infrastructure/repositories/prisma-place-write.repository.ts`;
  Gift Bot repository `src/database/schema.ts`.

### `GOV-03`. Versioned consent evidence

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** consent model в starter отсутствует. DARTS
  `FR-006` подтверждает отдельную фиксацию согласия при сборе паспортных и
  контактных данных; `FR-007/U-003` оставляют purpose, legal basis, texts,
  retention и deletion на обязательное исследование. Runtime реализации DARTS
  нет.
- **What could be added:** Product-specific ledger
  `subject + purpose + policyVersion/contentDigest + decision + capturedAt + source`,
  immutable grant/withdrawal history и отдельные enforcement checks.
- **Named consumer:** DARTS realtor onboarding/profile.
- **Failure model:** boolean без версии текста ничего не доказывает, withdrawal
  не останавливает зависимую обработку, consent связан не с тем subject, данные
  собираются до утверждения policy, history редактируется или evidence раскрывает
  лишние personal data.
- **Form:** Product-specific; Reference возможен после второго совпавшего
  purpose/enforcement contract.
- **Required dependencies:** subject identity, approved policy texts/purposes,
  processing decision, access и retention — Missing/Product-owned; PostgreSQL
  transaction — Available.
- **Conditional dependencies:** `GOV-02` для принятого append-only pattern;
  category 6 для notices; category 7 для signed artifacts.
- **Blocked by:** DARTS `U-003`: утверждённые поля, основания, тексты, сроки и
  круг доступа.
- **Unlocks:** доказуемый onboarding gate и downstream DARTS profile/offer
  processing.
- **Priority:** P2; concrete consumer есть, но policy product/legal-owned и reuse
  пока не доказан.
- **Reasons to defer / non-goals:** не создавать generic `consent=true`, не
  считать consent универсальным legal basis и не смешивать с mailbox
  verification, identity proofing или KYC.
- **Evidence:** DARTS repository `docs/product/prd.md`: `FR-006` is confirmed,
  while `FR-007` and `U-003` remain research/open policy decisions; none is
  runtime implementation.

### `GOV-04`. Privacy subject data export

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `INT-07` фиксирует общий bulk-export lifecycle как
  Deferred; privacy subject resolver, module exporters и protected artifact
  отсутствуют.
- **What could be added:** authenticated request, verified subject mapping,
  per-module export contributions, consistent snapshot, minimization/redaction,
  protected expiring artifact и operator recovery.
- **Named consumer:** пока не подтверждён. Gift Bot имеет конкретный связанный
  граф Telegram participant/draw/reroll data, но user export contract не
  определён.
- **Failure model:** неполный export, данные другого subject, inconsistent
  snapshot, excess PII, unbounded generation, leaked artifact или expired
  artifact остаётся доступным.
- **Form:** Product-specific orchestration.
- **Required dependencies:** named requester, authoritative subject resolver,
  data inventory, module exporters, access/format/retention contract —
  Missing/Product-owned.
- **Conditional dependencies:** `INT-07`, если lifecycle подходит; category 4
  jobs для большого набора; category 7 protected artifact; category 6
  completion notice; `GOV-02` sensitive-access record.
- **Blocked by:** named product requirement, dataset, identity-proof level и
  legal/product scope.
- **Unlocks:** subject-access portability и privacy operations UI.
- **Priority:** P2 после появления consumer.
- **Reasons to defer / non-goals:** не считать database dump экспортом, не
  включать secrets/internal audit/raw provider payload и не объединять export с
  erasure.
- **Evidence:** `INT-07` в этом каталоге; Gift Bot repository
  `src/database/schema.ts` является evidence сложности, не требованием.

### `GOV-05`. Erasure and anonymization orchestration

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `ID-04` удаляет auth-owned
  credentials/tokens/roles и tombstones email, но сохраняет `User.id` и
  product foreign keys. Это retirement, не erasure. DARTS требует определить
  deletion до сбора паспортных данных; Gift Bot показывает связанный
  participant/referral/draw/reroll graph.
- **What could be added:** product-owned privacy request aggregate и per-module
  outcomes `erased | anonymized | retained-with-reason`, legal-hold checks,
  retryable orchestration и completed evidence record.
- **Named consumer:** possible DARTS personal-profile lifecycle, but the exact
  subject-erasure request and outcome are still a research decision. Gift Bot is
  a second data-graph example, not a confirmed deletion consumer.
- **Failure model:** partial erase, hard delete ломает draw/referral/audit
  evidence, tombstone ошибочно объявлен полной очисткой, concurrent writes
  возвращают данные, external/files остаются, backup restore reintroduces values
  или выбран неверный subject.
- **Form:** Product-specific; повторяемый lifecycle может стать Reference.
- **Required dependencies:** authoritative subject mapping, data inventory,
  per-module erase/anonymize contracts including an auth-owned identity/session
  contribution, and retention/legal-hold policy — Missing/Product-owned.
- **Conditional dependencies:** `ID-04` only when its auth-retirement contract
  is reused as one module contribution; category 4 durable job/saga, category 5
  provider deletion, category 7 blob deletion and `GOV-02` operation evidence.
- **Blocked by:** DARTS `U-003`, exact access/data map и backup/restore
  treatment.
- **Unlocks:** trustworthy account closure и privacy operations.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не переименовывать auth retirement в
  erasure, не использовать global cascade delete, не удалять обязательную
  business/legal history без policy и не обещать physical backup deletion без
  отдельного contract.
- **Evidence:** [account administration runbook](runbooks/account-administration.md),
  [auth repository](../src/modules/auth/infrastructure/prisma-auth.repository.ts)
  и auth retirement integration test; DARTS repository
  `docs/product/prd.md`, `FR-007/U-003`.

### `GOV-06`. Product data retention and bounded purge

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** local telemetry retention `168h`, Outbox
  published-message cleanup и expiring auth tokens являются техническими
  локальными policies; общего product-data retention contract нет. DARTS
  требует определить сроки до сбора personal data; Gift Bot различает ephemeral
  callbacks и durable draw/reroll evidence, но purge policy не имеет.
- **What could be added:** code-owned data classes, lifecycle predicates, legal
  holds, indexed bounded batches, idempotent checkpoint/progress, failure
  observation и coordinated file/provider cleanup.
- **Named consumer:** DARTS passport/profile/documents и Gift Bot
  callback/participant/draw datasets.
- **Failure model:** active data удалена слишком рано, evidence хранится
  бесконечно, table scan создаёт production load, purge зацикливается, DB удалена
  без blobs/provider copies или restore возвращает expired data.
- **Form:** Product-specific policy; общая bounded-runner mechanics может стать
  Kit после повторения.
- **Required dependencies:** data classification, exact periods/lifecycle
  predicates, hold policy, indexes и backup semantics —
  Missing/Product-owned.
- **Conditional dependencies:** `REL-03` scheduler/runner, category 7 storage
  deletion, category 5 provider cleanup и `GOV-02` purge evidence.
- **Blocked by:** approved policies и restore treatment; технические defaults не
  могут выбрать product/legal сроки.
- **Unlocks:** `GOV-04`, `GOV-05` и bounded storage growth.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не вводить global TTL для всех таблиц, не
  переносить Loki/Outbox срок на product data и не удалять business evidence
  только по age.
- **Evidence:**
  [`errors-logging-observability.md`](architecture/errors-logging-observability.md),
  [`outbox-retention-cleanup.ts`](../src/platform/outbox/outbox-retention-cleanup.ts),
  DARTS repository `docs/product/prd.md` `U-003` и Gift Bot repository
  `src/database/schema.ts`.

### `GOV-07`. Generic support impersonation and break-glass sessions

- **Entry kind:** Capability.
- **Catalog status:** Rejected as a generic capability.
- **What already exists:** explicit administrator commands меняют target
  account без входа в пользовательскую сессию и выпускают `GOV-01` events.
  Impersonation отсутствует.
- **What could be added:** nothing generic. A separate future Product-specific
  support case could define reason/ticket, step-up, short expiry, isolated
  session, visible banner, action allowlist, immutable audit and user/security
  notification.
- **Named consumer:** отсутствует.
- **Failure model:** invisible account takeover, support получает больше прав
  пользователя, actions ошибочно приписываются user, stale session, credential
  exposure или privacy breach.
- **Form:** Rejected generic capability; a separate future support flow remains
  Product-specific.
- **Required dependencies:** none for the rejected entry.
- **Conditional dependencies:** a separate Product-specific case would require
  `ID-09`, `GOV-02`, explicit authorization and threat model; dual approval,
  notifications and recording depend on its accepted controls.
- **Blocked by:** generic capability is rejected; a separate product-specific
  case would require a named workflow and approved threat/security/privacy
  policy.
- **Unlocks:** controlled support diagnosis только для конкретного продукта.
- **Priority:** —.
- **Reasons to defer / non-goals:** не переиспользовать user cookie/session, не
  делать hidden impersonation, universal login-as или замену explicit support
  commands.
- **Evidence:** текущие
  [`account-administration.service.ts`](../src/modules/auth/application/account-administration.service.ts),
  `AuthAuditPort` и отсутствие impersonation route/state.

### Сводка зависимостей

| Entry    | Required before implementation/adoption                                       | Conditional                                               |
| -------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GOV-01` | Auth audit contract и structured log sink — Available                         | Hosted storage, retention и alerts                        |
| `GOV-02` | Module event vocabulary, actor/target, transaction, access и retention        | Outbox/archive, WORM/signing, protected artifacts         |
| `GOV-03` | Subject, purpose, versioned policy, processing/access/retention decisions     | `GOV-02`, notices, signed artifacts                       |
| `GOV-04` | Named requester, subject resolver, data inventory/exporters и access contract | `INT-07`, jobs, artifact storage, notice, sensitive audit |
| `GOV-05` | Subject/data map, module erase contracts, retention и holds                   | Jobs/saga, provider/blob deletion, `GOV-02`               |
| `GOV-06` | Data classes, lifecycle periods, holds, indexes и backup semantics            | `REL-03`, storage/provider cleanup, `GOV-02`              |
| `GOV-07` | Rejected generic; future case needs `ID-09`, audit и threat model             | Dual approval, notification, recording                    |

```text
GOV-01 -----------------------------> security investigation only
module transaction + product policy -> GOV-02
subject + legal/product policy -----> GOV-03
subject + data inventory -----------> GOV-04
subject + erase/hold policy --------> GOV-05
data classes + lifecycle policy ----> GOV-06
ID-09 + support case + GOV-02 ------> future bounded GOV-07
```

`GOV-02` — единственный P1 candidate категории: повторена module-owned
accountability, а не общий schema/store. Consent, export, erasure и retention
остаются product/legal-owned. `GOV-01` не является их shortcut, `ID-04` не
является erasure, а generic impersonation отклонён.

## 9. Human workflow и collaboration

### Граница категории

Category 9 владеет human-owned process state: submission, queue visibility,
decision, assignment, conversation и recovery. Authentication/RBAC подтверждают
actor, category 6 доставляет сообщения, category 7 хранит files/documents,
category 8 задаёт durable accountability/privacy, а category 10 владеет payment
и entitlement effects.

Approval, profile verification, moderation, service case, lead handoff и
external signing выглядят как «статусы и кнопки», но имеют несовместимые
invariants. Они остаются отдельными verticals. Generic workflow engine,
polymorphic comments service и universal assignment abstraction не нужны.

### `WF-01`. Approval request reference vertical

- **Entry kind:** Capability.
- **Catalog status:** Available.
- **What already exists:** production-wired create/get/decision vertical;
  author-or-`read` visibility, separate `decide` permission, self-decision
  prohibition, terminal `pending → approved|rejected` CAS, module problems,
  Prisma migration, OpenAPI и полный React reference UI.
- **What could be added:** ничего в эту карточку. Inbox, verification, messages
  и attachments рассматриваются отдельными capabilities.
- **Named consumer:** React starter routes `/approval-requests`, `/new`, `/open`
  и `/:requestId`.
- **Failure model:** unauthorized existence leak, author self-decision, два
  concurrent reviewer, repeated terminal decision, PostgreSQL outage и unsafe
  error details.
- **Form:** production-wired Reference.
- **Required dependencies:** `ID-01`, `ID-02`, product-owned RBAC, PostgreSQL,
  Problem Details и OpenAPI — Available.
- **Conditional dependencies:** category 6 notification, category 7 attachments
  и `GOV-02` только при future multi-event/queryable history.
- **Blocked by:** нет.
- **Unlocks:** executable module-boundary reference и `WF-02`.
- **Priority:** —; capability уже Available.
- **Reasons to defer / non-goals:** не добавлять generic CRUD, list/pagination,
  assignment, comments, notifications, reopen/delete или universal workflow
  engine в минимальный reference.
- **Evidence:** [`src/modules/approval-requests`](../src/modules/approval-requests),
  [approval migration](../prisma/migrations/20260728210000_approval_requests/migration.sql),
  approval unit/integration/e2e tests и React starter repository `README.md`.

### `WF-02`. Reviewer inbox and stable approval listing

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** React reviewer может открыть только известный UUID;
  backend имеет `findById`, но не list/query API.
- **What could be added:** permission-bounded pending/all list, stable cursor
  pagination, deterministic sort/filter и stale-state refresh после decision.
  Assignment остаётся за отдельным product requirement.
- **Named consumer:** maintained React approval UI, где reviewer сейчас получает
  request ID вне системы.
- **Failure model:** leaking foreign requests, unstable pagination
  skips/duplicates rows, unbounded list, stale pending item после другого
  decision или неверный count/filter.
- **Form:** Reference extension.
- **Required dependencies:** `WF-01` — Available; visibility rules, cursor
  contract и PostgreSQL indexes, например `(status, createdAt, id)` —
  Missing/Repository-owned.
- **Conditional dependencies:** category 6 notification/digest;
  assignment/claim только после отдельной policy.
- **Blocked by:** решение, должен ли минимальный maintained reference
  расширяться до operational inbox. Product consumer может реализовать list в
  своей vertical независимо.
- **Unlocks:** reviewer queue UX.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не добавлять generic work queue,
  lease/assignment, SLA, comments или search engine.
- **Evidence:**
  [`approval-request.controller.ts`](../src/modules/approval-requests/presentation/approval-request.controller.ts),
  [`approval-request-repository.port.ts`](../src/modules/approval-requests/application/approval-request-repository.port.ts)
  и React starter action-hub documentation.

### `WF-03`. Business profile verification before role activation

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter предоставляет registration, roles и approval
  reference, но не profile submission/verification. DARTS `FR-001/FR-002`
  approved и `BR-001` confirmed требуют office-manager verification before
  realtor access. Runtime DARTS отсутствует.
- **What could be added:** Product-specific submission revision/snapshot, finite
  review outcome, non-self reviewer policy и explicit atomic/compensated
  activation boundary между profile decision и auth access.
- **Named consumer:** DARTS realtor onboarding.
- **Failure model:** unverified account получает access, reviewer принимает
  stale profile revision, decision commits, но role/access activation падает,
  retry активирует дважды, passport data раскрываются или profile меняется после
  approval.
- **Form:** Product-specific; Reference только после повторённого verification
  contract.
- **Required dependencies:** `ID-03` registration — Available/default-disabled;
  profile/document schema — Product-owned; explicit cross-module activation
  atomicity/compensation — Missing; DARTS consent/access/retention policy —
  Missing/Product-owned.
- **Conditional dependencies:** `GOV-02`, `GOV-03`, `GOV-06`, category 6
  notifications и category 7 files.
- **Blocked by:** exact DARTS checklist/outcomes, access matrix `U-006`,
  personal-data decision `U-003` и выбор authoritative activation state.
- **Unlocks:** DARTS realtor role access, initial offer и paid-service
  activation.
- **Priority:** P1 после product decisions: concrete consumer и часто
  повторяемый scenario.
- **Reasons to defer / non-goals:** mailbox verification не является business
  verification; не заявлять legal identity proof/KYC и не адаптировать `WF-01`
  без profile snapshot/access-activation contract.
- **Evidence:** DARTS repository `docs/product/prd.md`, requirements `FR-001`,
  `FR-002`, `BR-001`, `U-003` и `U-006`; это product documentation, не runtime.

### `WF-04`. Content and resource moderation lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Amazing EKB имеет material statuses
  `pending/approved/rejected/archived`, approved-only linking, place
  `active/hidden`, transactional `PlaceStatusTransition` и client-side bulk
  moderation recovery. В starter moderation отсутствует.
- **What could be added:** только resource-specific review queue, explicit
  visibility invariant, reason/evidence policy, CAS/versioning и partial
  bulk-operation recovery.
- **Named consumer:** Amazing EKB material review и place moderation.
- **Failure model:** stale reviewer перезаписывает другое решение, `approved`
  ошибочно считается public, content публикуется before review, bulk operation
  частично успешна, AI suggestion обходит human decision или status меняется без
  history.
- **Form:** Product-specific; Reference только после второго одинакового
  visibility/state contract.
- **Required dependencies:** concrete resource aggregate, state/visibility
  rules, RBAC, transaction/CAS и audit policy — Product-owned.
- **Conditional dependencies:** category 7 content/files, category 12
  recommendations, category 6 notifications и `GOV-02`.
- **Blocked by:** у starter нет собственного moderated resource; generic
  extraction заблокирована различием material/place semantics.
- **Unlocks:** human-in-the-loop AI review и bounded bulk moderation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** moderation не является generic approval: она
  владеет target lifecycle/public visibility и может иметь repeated/nonterminal
  transitions.
- **Evidence:** Amazing EKB repository `prisma/schema.prisma`,
  `src/modules/places/application/use-cases/update-place-status.use-case.ts`,
  `src/modules/places/infrastructure/repositories/prisma-place-write.repository.ts`
  и `docs/discovery-ai-assisted-place-discovery-readiness.md`.

### `WF-05`. Specialist service request case

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter не имеет ticket/case module. DARTS
  `FR-015/FR-016` confirmed требуют обращения к юристу, ипотечному или
  SMM-специалисту, statuses, correspondence и files; `FR-017` добавляет
  conditional payment. Runtime нет.
- **What could be added:** bounded case aggregate с requester, service type,
  responsible role/participant, product-defined states, protected
  conversation/file references и explicit commands.
- **Named consumer:** DARTS specialist requests.
- **Failure model:** request потерян, wrong specialist видит PII/files,
  concurrent status updates, removed specialist оставляет orphan, message/file
  commits отдельно, payment callback активирует case дважды или notification
  теряется.
- **Form:** Product-specific; Reference после повторённого case contract.
- **Required dependencies:** auth roles/RBAC — Available
  mechanism/Product-owned catalog; exact state/assignment/access rules and
  category 7 protected files — Missing.
- **Conditional dependencies:** `GOV-02` when durable action history is an
  accepted product requirement; category 6 delivery, category 10
  payment/entitlement and `REL-02`/BullMQ only when loss after DB commit is
  unacceptable.
- **Blocked by:** DARTS state machine, assignment/reassignment policy, `U-006`
  access matrix, file и retention contracts.
- **Unlocks:** `WF-09`, paid additional services и case notifications.
- **Priority:** P1 после product decisions.
- **Reasons to defer / non-goals:** не делать generic ticket/CRM/workflow
  engine, arbitrary form builder или global messages table.
- **Evidence:** DARTS repository `docs/product/prd.md`, requirements `FR-015`,
  `FR-016`, `FR-017` и `U-006`; это product documentation, не runtime.

### `WF-06`. Manual lead handoff and assignment

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** DARTS `FR-025/FR-026` и `BR-007` confirmed требуют
  manual office-manager handoff of lead data/files выбранному realtor. Runtime
  нет.
- **What could be added:** Product-specific lead/handoff aggregate, explicit
  assign/reassign operations, current assignee visibility и durable
  actor/history. Не добавлять статусы, которых PRD ещё не определил.
- **Named consumer:** DARTS manual lead distribution.
- **Failure model:** assignment race, wrong realtor получает personal data,
  revoked role сохраняет access, unfinished work orphaned после role removal,
  duplicate lead или files остаются visible после reassignment.
- **Form:** Product-specific.
- **Required dependencies:** product lead schema, realtor role,
  assignment/access/reassignment policy and category 7 files —
  Missing/Product-owned.
- **Conditional dependencies:** `GOV-02` when durable assignment history is an
  accepted product requirement; category 6 notification; category 5 CRM
  integration only in a future phase and not for v1.
- **Blocked by:** DARTS `U-006`, lead data schema и retention policy.
- **Unlocks:** manual v1 lead operations без CRM replacement.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не строить CRM funnel, automatic import,
  round-robin/router или generic assignment engine.
- **Evidence:** DARTS repository `docs/product/prd.md`, requirements `FR-025`,
  `FR-026`, `BR-007` и `U-006`; это product documentation, не runtime.

### `WF-07`. Public inquiry intake

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** roadmap называет `Public inquiries` adoption track,
  но module, form schema и named product consumer отсутствуют.
- **What could be added:** один bounded inquiry Reference: immutable intake,
  anti-abuse, finite product statuses, operator visibility и optional
  assignment.
- **Named consumer:** не выбран; roadmap содержит только adoption trigger:
  anonymous visitors submit leads или service requests.
- **Failure model:** spam, duplicate request, PII leak, accepted-but-lost
  inquiry, unbounded payload/file, operator race или missing retention.
- **Form:** сначала Product-specific; затем Reference при доказанном reuse.
- **Required dependencies:** concrete form/schema, anti-abuse,
  status/visibility/retention policy и operator workflow —
  Missing/Product-owned; Core HTTP/PostgreSQL — Available.
- **Conditional dependencies:** category 6 acknowledgement/notification,
  category 7 attachments и `REL-02`, если committed inquiry обязана
  гарантированно создать delivery.
- **Blocked by:** named public product flow и exact data/operator contract.
- **Unlocks:** lead/contact intake.
- **Priority:** P3 до consumer.
- **Reasons to defer / non-goals:** не создавать dynamic form builder, generic
  CRM/ticket system или обязательную queue.
- **Evidence:** [product capability triggers](roadmap.md#product-capability-triggers);
  runtime отсутствует.

### `WF-08`. External multi-party offer action process

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** DARTS scope включает одну initial offer через одного
  external EDO provider; document status current, scope approved, но
  `implementation_readiness: research_required`. Runtime нет.
- **What could be added:** Product-specific aggregate с immutable
  template/data snapshot, participants, normalized/internal provider states,
  idempotent send, terminal history и guarded completion effect.
- **Named consumer:** DARTS initial package offer.
- **Failure model:** duplicate provider package, wrong template/data подписаны,
  out-of-order/replayed webhook, participant route частично завершён, provider
  outage, unauthorized final document или `completed` ошибочно активирует
  services.
- **Form:** Product-specific composite.
- **Required dependencies:** approved legal route/provider/template/storage,
  provider-specific verified intake, authoritative read/reconciliation and
  protected document/privacy/history contracts —
  Missing/Environment-owned/Product-owned.
- **Conditional dependencies:** `INT-03`/`INT-05` only if their extracted
  contracts fit, `INT-01`, category 4 durable retries, category 6 notifications
  and category 10 activation/entitlement effect.
- **Blocked by:** DARTS `U-004`: provider/product, signing/acceptance model,
  authorized parties, time limit, originals и retention.
- **Unlocks:** DARTS package activation после отдельных verification и payment
  gates.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не реализовывать собственную e-signature,
  universal document router, multiple providers или generic workflow engine.
- **Evidence:** DARTS repository `docs/product/edo-signing-v1.md` и
  `docs/product/prd.md`, requirements `FR-008`, `BR-008` и `U-004`; это approved
  scope с research blockers, не runtime.

### `WF-09`. Case-local conversation and comments

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** DARTS подтверждает correspondence внутри `WF-05`;
  generic comments/mentions infrastructure в starter отсутствует. Mentions не
  подтверждены.
- **What could be added:** внутри service-request module: ordered immutable
  message identity, author/time, participant ACL, explicit edit/delete policy и
  attachment references. Mentions — отдельное later extension.
- **Named consumer:** DARTS specialist request correspondence.
- **Failure model:** message виден вне case, edit уничтожает evidence, duplicate
  send после retry, order ambiguous, deleted/blocked actor ломает projection,
  mention storm или attachment ACL отличается от message ACL.
- **Form:** Product-specific.
- **Required dependencies:** `WF-05`, participant/resource ACL и message
  retention/edit policy — Missing/Product-owned.
- **Conditional dependencies:** category 6 delivery для new-message notices,
  category 7 attachments и `GOV-02` только для sensitive actions/edits.
- **Blocked by:** сначала `WF-05` state/access contract; mentions заблокированы
  отсутствием consumer и notification-preference policy.
- **Unlocks:** specialist correspondence.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать cross-module comments service,
  global polymorphic target, arbitrary HTML, reactions/threads/mentions до
  requirements.
- **Evidence:** DARTS repository `docs/product/prd.md`, requirement `FR-016`;
  runtime implementation отсутствует.

### `WF-10`. Generic configurable workflow engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** approval, moderation, Gift Bot reroll и DARTS
  offer/case flows имеют несовместимые invariants, actors, transitions и failure
  recovery.
- **What could be added:** ничего общего сейчас; каждый vertical владеет typed
  aggregate и explicit commands.
- **Named consumer:** отсутствует.
- **Failure model:** invalid runtime definitions, authorization bypass,
  unreviewable state explosion, schema/version migration failure, generic retries
  повторяют business effects или observability теряет business meaning.
- **Form:** Product-specific configuration только если будущий named product
  явно требует user-configurable workflows; generic starter form Rejected.
- **Required dependencies:** none for the rejected generic entry.
- **Conditional dependencies:** a separate future Product-specific capability
  would need a named consumer, versioned definition language, migration
  semantics, authorization and recovery model.
- **Blocked by:** generic configurable-workflow direction is rejected. A future
  product explicitly requiring runtime configuration would define a separate
  Product-specific capability.
- **Unlocks:** ничего для текущего starter.
- **Priority:** —.
- **Reasons to defer / non-goals:** никакого BPMN/DSL, generic
  `status/transitions` tables, universal task engine или common
  repository/controller/service.
- **Evidence:** [approval reference design](superpowers/specs/2026-07-28-reference-approval-requests-design.md)
  исключает universal workflow engine; DARTS repository
  `docs/product/edo-signing-v1.md` исключает universal signing route; Amazing
  EKB moderation и Gift Bot reroll подтверждают разные semantics.

### Сводка зависимостей

| Entry   | Required before implementation/adoption                              | Conditional                                              |
| ------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `WF-01` | Auth/session/RBAC, PostgreSQL, Problems и OpenAPI — Available        | Notifications, attachments, future business history      |
| `WF-02` | `WF-01`, visibility, cursor contract и indexes                       | Notification/digest, later assignment policy             |
| `WF-03` | Registration, profile schema, activation boundary, privacy decisions | Audit, consent, retention, notification, files           |
| `WF-04` | Resource aggregate, state/visibility, RBAC, CAS и audit policy       | Files, AI suggestion, notification                       |
| `WF-05` | Roles, case states/assignment/access and protected files             | Audit, delivery, payment/entitlement, Outbox/BullMQ      |
| `WF-06` | Lead schema, roles, assignment/access, files and retention           | Audit, notification; future CRM integration              |
| `WF-07` | Public form, anti-abuse, statuses, visibility и retention            | Acknowledgement, attachments, transaction-coupled send   |
| `WF-08` | Legal/provider/template/storage, verified intake/reconcile, privacy  | `INT-03/05`, retry, notification, entitlement activation |
| `WF-09` | `WF-05`, participant ACL, message edit/delete/retention policy       | Notification, attachments, sensitive-action audit        |
| `WF-10` | Rejected generic workflow engine                                     | Future Product-specific capability is separate           |

```text
WF-01 ------------------------------> WF-02
ID-03 + profile + privacy/access policy -> WF-03
resource lifecycle + visibility ----> WF-04
roles + case state + DATA-03 -------> WF-05 -> WF-09
lead schema + access + DATA-03 -----> WF-06
public form + anti-abuse -----------> WF-07
provider/legal + intake/reconcile + DATA-03 -> WF-08
```

`WF-03` и `WF-05` — P1 candidates с named DARTS consumers, но их product
decisions ещё блокируют implementation. `WF-04`, `WF-06` и `WF-08` сохраняют
Product-specific semantics. Порядок строк не является roadmap.

### Cross-category ownership

- `GOV-01` остаётся security telemetry категорий 1/2; `GOV-02` — durable
  business semantics категории 8.
- `ID-04` auth retirement является только одним auth-specific step и не
  реализует `GOV-05`.
- `WF-01` принимает terminal decision о request. `WF-04` владеет lifecycle и
  public visibility target; moderation не сводится к approval.
- Workflow state/participants принадлежат category 9; delivery — category 6;
  files/documents — category 7; audit/consent/retention — category 8.
- DARTS EDO: human process, legal aggregate, template and final document —
  `WF-08`; provider webhooks/reconciliation — category 5; category 7 owns only
  protected bytes/storage; package activation/payment — category 10.
- Category 12 может предложить решение, но authorization и final human
  transition остаются в category 9.
- DARTS profile verification — business eligibility, не mailbox verification и
  не автоматически legal identity proofing.

### Wiring и removal boundary для `approval-requests`

`WF-01` production-wired без feature flag. «Optional» означает, что Reference
можно удалить или адаптировать в source, а не что он inert или default-disabled
в runtime. Его routes входят в статический OpenAPI.

При удалении из уже работающего проекта нужно одновременно изменить:

- `src/modules/approval-requests` и import `ApprovalRequestsModule` из
  `src/bootstrap/api/api.module.ts`;
- permission/role contribution в `api-auth.roles.ts` и HTTP problem contribution
  в `api-http-problems.ts`;
- Prisma enum/model, обе `User` relations и database schema;
- static tag/description in `src/platform/http/docs/openapi-document.ts`,
  committed OpenAPI, problem docs, OpenAPI architecture docs,
  foundation/roadmap/README and module docs;
- approval unit/integration/e2e suites, migration-from-empty expectations,
  auth retirement test с retained approval foreign key, cross-cutting OpenAPI
  problem/presentation-metadata tests and CLI/tests/docs with
  `approval.reviewer`;
- соответствующие generated contracts, routes, entities, features и pages в
  React starter, если frontend скопирован вместе с backend.

После source changes нужно заново выполнить Prisma generation и OpenAPI
generation/validation, а не редактировать generated contracts вручную.

Если approval migration уже применена хотя бы в одном environment, historical
migration остаётся неизменной, а удаление таблицы/enum выполняется новой forward
migration. Только pristine copy до первого применения migrations может
пересобрать исходный migration set. Перед drop данных продукт явно решает,
нужно ли сохранить или экспортировать существующую decision history.

## 10. Commerce, entitlements и allocation

### Граница категории

В текущем starter нет order, payment, subscription, entitlement, quota,
booking или pricing models и нет payment-provider dependency. Core PostgreSQL
transactions, Auth/RBAC, Outbox, BullMQ и integration boundaries являются
только prerequisites: они не задают денежную или allocation policy.

Главный подтверждённый consumer категории — продуктовый контракт портала ДАРТС:
payment-link checkout, signed provider result/reconciliation, месячные пакеты,
оплаченный период, service orders, usage limits и переговорные. Это approved
product contract, но не реализованный runtime starter. Gift Bot отдельно
подтверждает auditable randomized allocation; его fairness/reroll semantics не
обобщаются до платежей, booking или quota.

### `BIZ-01`. Payment-linked order and provider confirmation

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Core даёт transactions, Auth/RBAC и safe HTTP
  boundary; Outbox/BullMQ доступны opt-in. Payment/order state, provider adapter,
  callback и reconciliation в starter отсутствуют.
- **What could be added:** provider-specific checkout Reference: immutable
  order amount/currency/purpose snapshot, idempotent payment-link creation,
  external identities, signed callback intake, authoritative provider-status
  read и atomic transition to paid only from an accepted provider state.
- **Named consumer:** портал ДАРТС: отдельная payment link для package или
  additional-service order; browser redirect не подтверждает оплату, а repeated
  callback/reconciliation не должен повторно активировать product state.
- **Failure model:** duplicate or forged callback, redirect accepted as payment,
  amount/currency mismatch, ambiguous link creation timeout, late result,
  provider outage, callback loss, double activation и payment state committed
  без соответствующего order transition.
- **Form:** Product-specific order/payment domain + provider-specific Reference;
  общий transport остаётся Kit только там, где его contract действительно
  совпадает.
- **Required dependencies:** authoritative order and money state, stable
  provider identities, verified callback contract, idempotent atomic transition
  и provider read/reconciliation operation — Product-owned/Missing.
- **Conditional dependencies:** `INT-01`, `INT-03` и `INT-05`, если их bounded
  contracts подходят без расширения; Outbox/BullMQ для transaction-coupled
  work; category 8 audit и category 6 customer notification.
- **Blocked by:** merchant/environment inputs, exact provider permissions,
  fiscalization configuration, live acceptance evidence и product refund/error
  policy.
- **Unlocks:** `BIZ-02`, paid `BIZ-04` orders и later `BIZ-07`.
- **Priority:** P1; есть approved named consumer и конкретный duplicate/loss
  contract.
- **Reasons to defer / non-goals:** не принимать redirect as proof, не хранить
  card data, не строить multi-acquirer switch, generic `PaymentService` или
  exactly-once promise и не включать refunds/recurring billing автоматически.
- **Evidence:** DARTS `docs/product/prd.md` FR-012–FR-014 and BR-011 плюс
  `docs/product/scope-v1.md` являются external product evidence; отсутствие
  starter runtime видно в [`schema.prisma`](../prisma/schema.prisma).

### `BIZ-02`. Prepaid plan and subscription-access lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter не хранит plan version, paid period,
  subscription state или renewal policy. DARTS product contract фиксирует
  месячные packages и three-month prepayment, но не automatic recurring charge.
- **What could be added:** product-owned plan/version catalog, explicit
  activation prerequisites, paid-period ledger, deterministic start/end rules,
  renewal/overlap handling и operator-visible state. Initial activation может
  требовать одновременно confirmed payment и completed offer ceremony.
- **Named consumer:** ДАРТС WHITE/GREY/BLACK: пользователь видит package и
  paid period; payment activates access for one or three prepaid months without
  implicit auto-renewal.
- **Failure model:** overlapping or missing periods, timezone/month-boundary
  drift, late callback shortening access, replay extending twice, plan change
  rewriting historical terms, offer/payment facts arriving in different order
  и expiration job silently failing.
- **Form:** Product-specific vertical; повторяемые calendar primitives сами по
  себе не создают subscription platform.
- **Required dependencies:** immutable plan version, authoritative activation
  facts, explicit calendar/timezone rules, period transition invariants и
  product access policy — Product-owned/Missing.
- **Conditional dependencies:** `BIZ-01` для provider-paid activation; external
  offer/signing integration; scheduler for expiration; category 6 reminders.
- **Blocked by:** exact renewal, package-change, start/end, overlap and grace
  rules; DARTS contract intentionally leaves these details for module design.
- **Unlocks:** period-scoped `BIZ-03` entitlements and expiry communication.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не строить generic SaaS billing, proration,
  invoice/tax engine, saved payment methods или automatic recurring charges;
  access period remains product state, not a provider status projection.
- **Evidence:** DARTS `docs/product/prd.md` FR-009–FR-011 and BR-008 plus current
  package catalog are named external evidence; starter has no corresponding
  model.

### `BIZ-03`. Entitlement and quota-consumption ledger

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** starter has no entitlement or usage state. DARTS
  contract requires used/available services, period limits, unlimited package
  items and gifts from three-month prepayment; exact WHITE limits and reversal
  rules remain unresolved.
- **What could be added:** immutable entitlement grant/version, atomic
  idempotent consume/reverse operations, period scope, bounded unlimited
  representation, reason/source references and a rebuildable read projection.
- **Named consumer:** DARTS package services: legal/mortgage requests, extracts,
  SMM/media services and prepaid gifts with included versus paid-over-limit
  behavior.
- **Failure model:** concurrent double consumption, negative balance, duplicate
  command, period rollover losing usage, cancellation without reversal,
  retroactive plan edit changing history, `unlimited` represented as an unsafe
  number and analytics counter mistaken for authoritative allowance.
- **Form:** Product-specific first; a narrow ledger Reference is possible only
  after another product repeats consume/reverse/period semantics.
- **Required dependencies:** versioned entitlement catalog, period identity,
  atomic idempotency key, consume/reverse business event and explicit
  compensation policy — Product-owned/Missing.
- **Conditional dependencies:** `BIZ-02` for subscription-scoped grants;
  `BIZ-04` for over-limit paid service; Outbox for derived projections.
- **Blocked by:** exact included quantities, consumption moment, cancellation
  reversal, carry-over and package-change rules.
- **Unlocks:** safe package enforcement and derived usage reporting.
- **Priority:** P2; consumer is real, but decisive product rules are still open.
- **Reasons to defer / non-goals:** не делать generic feature-flag/quota engine,
  не использовать dashboard counters as source of truth и не смешивать money,
  access grants and analytics in one table.
- **Evidence:** DARTS `docs/product/prd.md` FR-032, BR-011 and uncertainty U-002
  are named external evidence.

### `BIZ-04`. Catalog-priced and negotiated service orders

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** approval Reference показывает bounded state
  transition pattern, но service catalog/order/quote state отсутствует.
- **What could be added:** product service catalog, immutable price/terms
  snapshot per order, separate fixed-price and operator-priced paths, explicit
  order state machine and authorization for who may set a negotiated amount.
- **Named consumer:** DARTS additional services: fixed-price order after catalog
  selection or individually priced order after an authorized specialist sets
  the amount; payment is required only when service is outside package terms.
- **Failure model:** client price tampering, stale catalog price, unauthorized
  negotiated amount, duplicate order, payment attached to another revision,
  service execution before entitlement/payment decision and cancellation after
  work begins.
- **Form:** Product-specific vertical; order-state patterns may later become a
  Reference, but catalog/pricing policy remains product-owned.
- **Required dependencies:** product catalog, immutable terms/price snapshot,
  actor permissions, explicit states/transitions and idempotent create command —
  Product-owned/Missing.
- **Conditional dependencies:** `BIZ-03` for included allowance, `BIZ-01` for
  paid order, category 9 specialist workflow and category 7 files.
- **Blocked by:** exact service fields, pricing authority, state transitions and
  cancellation/fulfilment rules.
- **Unlocks:** one bounded path for included and paid specialist services.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не добавлять generic cart, promotions,
  inventory, tax or marketplace abstractions and не выводить state machine из
  названия `Order` без concrete process.
- **Evidence:** DARTS `docs/product/prd.md` FR-015–FR-017 and D-11 are named
  external product evidence.

### `BIZ-05`. Resource availability and booking with operator override

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** PostgreSQL transaction foundation доступна; resource,
  slot, reservation and calendar APIs отсутствуют.
- **What could be added:** product resource calendar, normalized interval and
  timezone policy, concurrency-safe reserve/change/cancel transitions, stale
  precondition handling and an explicit operator-override path.
- **Named consumer:** ДАРТС meeting-room calendar: realtor creates a booking,
  office manager sees and changes it.
- **Failure model:** double booking under concurrency, stale availability,
  overlapping interval edge, DST/timezone drift, operator edit racing user
  cancellation, orphaned hold, invisible maintenance window and notification
  failure misreported as booking failure.
- **Form:** Product-specific first; reusable interval-conflict mechanics may
  become a Reference only with repeated scheduling semantics.
- **Required dependencies:** resource/interval identity, timezone and overlap
  rules, database exclusion/locking strategy, ownership/permissions and
  transition policy — Product-owned/Missing.
- **Conditional dependencies:** category 6 notifications, category 8 durable
  change history and payment only for a separately priced booking product.
- **Blocked by:** duration/grid, horizon, conflict, cancellation, override and
  maintenance rules.
- **Unlocks:** meeting-room booking and later resource-specific scheduling.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать generic calendar/appointment
  platform, recurrence engine or temporary hold unless named workflow needs it;
  payment is not a default dependency.
- **Evidence:** DARTS `docs/product/prd.md` FR-021/FR-022 and current booking
  open questions are named external evidence.

### `BIZ-06`. Auditable randomized allocation and bounded reroll

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** external Gift Bot implements durable draw claim,
  final eligibility check, immutable weighted snapshot/order, immediate result,
  post-publication single-place reroll and append-only private audit. Starter
  has no contest/allocation module.
- **What could be added:** maintained Product-specific Reference preserving
  eligibility snapshot, injected cryptographic random source, unique assignment,
  resumable publication and deterministic next-candidate reroll contract.
- **Named consumer:** Gift Bot giveaway completion and team-only reroll after a
  suspected bot is observed; no pre-publication review state exists.
- **Failure model:** eligibility changes during selection, rerandomization after
  restart, duplicate winner, partial result publication, reroll silently
  rewriting history, public leakage of rejection reason and biased or
  non-auditable randomness.
- **Form:** Product-specific Reference candidate; not a generic optimization,
  lottery or allocation engine.
- **Required dependencies:** product eligibility/ticket rules, immutable
  snapshot and order, injected random source, durable result/version and
  append-only private audit — Product-owned in Gift Bot.
- **Conditional dependencies:** category 4 scheduling/recovery, category 6
  publication and category 8 business audit when adopted elsewhere.
- **Blocked by:** no technical blocker in Gift Bot; adding a maintained
  Product-specific Reference to this starter requires a separate roadmap and
  maintenance decision. A second consumer is needed only before promoting
  common mechanics into a Kit.
- **Unlocks:** a copyable contest draw Reference with explicit recovery and
  reroll semantics.
- **Priority:** P2; one proven Product-specific allocation Reference, without a
  second compatible allocation consumer.
- **Reasons to defer / non-goals:** не обещать certified randomness, gambling
  compliance, generic allocation optimization or fairness across unrelated
  domains; do not add a pending-review state contrary to the consumer.
- **Evidence:** external Gift Bot `docs/epics/03-draw-and-reroll.md` and
  `src/application/giveaway-draw-service.ts` are current product evidence.

### `BIZ-07`. Refund and payment-reversal lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no refund model or command. DARTS provider research
  confirms an external refund operation, while current v1 explicitly excludes
  automated portal refunds and does not define actor or compensation policy.
- **What could be added:** authorized full/partial refund request, idempotent
  provider operation, durable pending/final state, reconciliation and explicit
  compensation of order, paid period and consumed entitlement state.
- **Named consumer:** possible later DARTS operator flow; current approved v1 is
  evidence for the boundary but not authorization to implement it.
- **Failure model:** duplicate/over refund, partial refund represented as full,
  provider success with local timeout, money reversed while access remains,
  entitlement restored twice, refund after fulfilled service and chargeback
  confused with operator refund.
- **Form:** provider-specific Reference + Product-specific compensation policy.
- **Required dependencies:** authoritative payment state, refund permissions and
  reason, provider idempotency/read contract, accounting/fiscalization decision
  and product compensation semantics — Missing/Product-owned.
- **Conditional dependencies:** `BIZ-01`, `INT-05`, BullMQ and customer/operator
  communication.
- **Blocked by:** explicit product scope, actor rights, full/partial rules and
  consequences for subscription, order and quota state.
- **Unlocks:** bounded post-payment correction without direct database edits.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не включать chargeback ledger, accounting
  system, internal wallet or automatic dispute handling and не считать provider
  API support готовым product workflow.
- **Evidence:** DARTS current scope explicitly excludes automated refunds and
  records the unresolved consequences as external product evidence.

### `BIZ-08`. Generic commerce engine

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** только independent technical prerequisites and
  concrete external product contracts; общего commerce domain нет.
- **What could be added:** ничего как combined capability. Payment, subscription,
  entitlement, order, booking, draw and refund evolve independently.
- **Named consumer:** отсутствует product, которому одновременно нужен один
  reusable cart/catalog/pricing/tax/promotion/inventory/subscription engine.
- **Failure model:** lowest-common-denominator model hides money and entitlement
  invariants, forces unrelated workflows into one state machine and makes
  removal or provider change unsafe.
- **Form:** Rejected as generic capability.
- **Required dependencies:** нет.
- **Conditional dependencies:** отдельные `BIZ-01`–`BIZ-07` выбираются только по
  product contract.
- **Blocked by:** rejected direction, а не missing implementation.
- **Unlocks:** ничего; явное отклонение защищает independent verticals.
- **Priority:** —.
- **Reasons to defer / non-goals:** не создавать Shopify/Stripe-like domain,
  dynamic rule engine or universal `Money` workflow inside starter; общими могут
  быть только доказанные technical mechanisms.
- **Evidence:** различающиеся DARTS payment/booking/quota и Gift Bot draw failure
  models показывают отсутствие единого aggregate.

### Сводка зависимостей

| Entry    | Required before implementation                                     | Conditional                                         |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| `BIZ-01` | Order/money state, provider IDs, signed intake, atomic idempotency | `INT-01/03/05`, Outbox/BullMQ, audit, notifications |
| `BIZ-02` | Plan version, activation facts, calendar and access policy         | `BIZ-01`, offer integration, scheduler, reminders   |
| `BIZ-03` | Entitlement catalog, period, consume/reverse idempotency           | `BIZ-02`, `BIZ-04`, Outbox projections              |
| `BIZ-04` | Service catalog, terms/price snapshot, permissions, order states   | `BIZ-03`, `BIZ-01`, workflow, files                 |
| `BIZ-05` | Resource/interval rules, concurrency control and permissions       | Notifications, audit, product-specific payment      |
| `BIZ-06` | Eligibility, immutable snapshot/order, random source and audit     | Scheduling/recovery and publication                 |
| `BIZ-07` | Payment state, refund rights, provider operation and compensation  | `BIZ-01`, reconciliation, worker, communication     |
| `BIZ-08` | Rejected combined engine                                           | Choose only independently justified verticals       |

Payment provider topology не является hard dependency на generic Integration
Inbox или outbound runner: первый Reference может владеть своим bounded adapter.
`BIZ-03` остаётся authoritative commerce state, а category 11 строит только
derived reporting. `BIZ-05` и `BIZ-06` не зависят от payments.

## 11. Analytics и reporting

### Граница категории

Эта категория владеет определением product metrics, derived read models и
human-readable reports. Она не владеет technical SLO/telemetry (`PF-06`),
authoritative quota (`BIZ-03`), durable business audit (category 8), bulk export
artifact (`INT-07`) или AI reasoning (category 12).

Starter не содержит event analytics SDK, report module, warehouse или product
metric catalog. Amazing EKB и Gift Bot подтверждают необходимость bounded
product counters, но их значения и recovery различаются; это evidence для
product-owned projections, а не для generic analytics framework.

### `AN-01`. Product-owned counters and operational read models

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** Core PostgreSQL/HTTP foundation позволяет строить
  read models, но starter не определяет product counters. Amazing EKB хранит
  import-run counters и вычисляет place/material summaries; Gift Bot хранит
  participant/publication task state and counters.
- **What could be added:** maintained Reference pattern for explicitly defined
  counters: owner, source facts, freshness, consistency class, rebuild path,
  authorization and bounded query/projection strategy.
- **Named consumer:** Amazing EKB admin/public place and import-run summaries;
  Gift Bot participant and synchronization progress.
- **Failure model:** ambiguous metric definition, double counting after retry,
  projection drift, expensive live aggregation, stale cache presented as
  authoritative, rebuild changing historical result and cross-tenant/private
  dimensions leaking through a summary.
- **Form:** Product-specific read model; only repeated projection mechanics may
  become a Reference, never the metric semantics.
- **Required dependencies:** named actor/question, precise source facts and
  dimensions, consistency/freshness contract, access policy and rebuild or
  correction procedure — Product-owned.
- **Conditional dependencies:** Outbox for asynchronous projection, BullMQ for
  rebuild, cache for read scale and `INT-07` for exported snapshot.
- **Blocked by:** no technical starter blocker after product definitions exist;
  extraction into a generic Kit remains blocked by incompatible consumers.
- **Unlocks:** bounded dashboards and `AN-03` reports without querying business
  aggregates ad hoc everywhere.
- **Priority:** P2 because repetition proves the need for product-local read
  models, but not one reusable metric/schema contract or enough maintenance
  value for a shared starter slice.
- **Reasons to defer / non-goals:** не создавать global counter service,
  arbitrary group-by API or analytics schema before a metric owner; operational
  progress is not automatically a business KPI.
- **Evidence:** external Amazing EKB import/place counter implementations and
  Gift Bot durable participant/sync state are named consumer evidence.

### `AN-02`. Versioned business-fact ledger for derived analytics

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** transactional Outbox can emit product-owned events,
  but it is delivery state, not an analytical fact model. No retained event/fact
  ledger or metric computation contract exists.
- **What could be added:** append-only versioned business facts with stable event
  identity, occurred/recorded time, allowlisted dimensions, correction policy
  and deterministic recomputation into product metrics.
- **Named consumer:** no current product has approved retention and metric
  definitions requiring a separate analytics fact ledger. DARTS quota usage is
  authoritative commerce state first, not sufficient justification.
- **Failure model:** duplicate facts, mutable event meaning, late arrival,
  backfill double count, correction rewriting history, high-cardinality/PII
  dimensions and treating an at-least-once transport record as a business fact.
- **Form:** Product-specific first; possible Reference after repeated
  event/version/correction semantics.
- **Required dependencies:** named metrics and owners, source-of-truth events,
  schema/version and retention/privacy contracts — Missing/Product-owned.
- **Conditional dependencies:** Outbox for transaction-coupled handoff, BullMQ
  for projection/rebuild and warehouse only after a volume/query trigger.
- **Blocked by:** concrete analytical question, retained dimensions, correction
  semantics and measured need beyond direct read models.
- **Unlocks:** reproducible historical metrics and controlled backfill.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не превращать Outbox в event store, не писать
  every CRUD mutation as analytics event и не duplicate authoritative commerce
  ledger.
- **Evidence:** current Outbox non-goals in
  [`transactional-outbox-adoption.md`](architecture/transactional-outbox-adoption.md)
  and absence of an analytics consumer in starter.

### `AN-03`. Product report definition and reproducible snapshot

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `INT-07` описывает future protected export artifact,
  но report metric/query/layout and snapshot semantics отсутствуют. DARTS
  mentions future administrator reporting without accepted measures.
- **What could be added:** one named report with versioned measure definitions,
  actor/filters/timezone, `asOf` snapshot, safe totals/drill-down, generation
  status and reproducibility metadata.
- **Named consumer:** DARTS realtor/work reporting is an out-of-v1 direction and
  still lacks accepted questions, measures and source completeness; no active
  report consumer is ready for implementation.
- **Failure model:** totals with incompatible definitions, time-window drift,
  mutable report after delivery, unauthorized row exposure, partial data shown
  as complete, rounding mismatch and generated artifact outliving retention.
- **Form:** Product-specific report; artifact lifecycle may reuse `INT-07`.
- **Required dependencies:** report owner/actor, versioned metric definitions,
  source completeness, snapshot/access and retention rules — Missing.
- **Conditional dependencies:** `AN-01`/`AN-02` data sources, `INT-07` artifact,
  category 6 delivery and category 12 narrative only after deterministic totals.
- **Blocked by:** named current report and accepted metric dictionary.
- **Unlocks:** operator/customer reporting and later AI-assisted explanation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не создавать generic report builder, SQL
  passthrough, universal CSV template or AI summary before deterministic report
  truth.
- **Evidence:** DARTS current PRD explicitly leaves AI/extended analytics outside
  v1; starter contains no report contract.

### `AN-04`. Product-behavior analytics provider adoption

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** request logs/traces exist for operations, but no
  product event taxonomy, browser/server analytics SDK or analytics provider is
  installed. Operational telemetry must not be repurposed silently.
- **What could be added:** provider-specific Reference with an allowlisted event
  catalog, stable anonymous/authenticated subject policy, server/browser
  deduplication, consent/opt-out, deletion mapping and environment separation.
- **Named consumer:** none of the verified starter products has an approved
  behavior-analytics question/provider and privacy contract.
- **Failure model:** PII/secrets in properties, duplicate client/server events,
  identity merge across users, ad-blocked client data interpreted as complete,
  schema drift, test traffic contaminating production and consent/deletion not
  propagated.
- **Form:** provider-specific Reference; transport wrapper alone is not a useful
  generic Kit.
- **Required dependencies:** product questions/event catalog, selected provider,
  identity/consent/retention/deletion and environment contracts — Missing.
- **Conditional dependencies:** category 8 consent/privacy operations and
  Outbox/server delivery for selected critical events.
- **Blocked by:** named consumer, provider and legal/product data policy.
- **Unlocks:** funnel/retention analysis for that product, not operational SLOs.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не add a tracker by default, не mirror all
  HTTP requests, не create vendor-neutral lowest-common-denominator analytics
  port and не treat missing client events as zero behavior.
- **Evidence:** no analytics dependency/model/config is present in
  [`package.json`](../package.json) or [`schema.prisma`](../prisma/schema.prisma).

### `AN-05`. Generic warehouse, BI and semantic layer

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** product databases and small bounded read models in
  external products; no analyst team, warehouse, CDC or cross-product metric
  governance contract is present.
- **What could be added:** nothing as a starter default. A future product may
  choose warehouse/CDC/modeling tools after data volume and query ownership are
  measured.
- **Named consumer:** отсутствует consumer requiring cross-source historical BI
  rather than module-owned queries/projections.
- **Failure model:** duplicated truth, stale CDC, uncontrolled PII replication,
  metric-name consistency without semantic consistency, high cost and platform
  ownership burden before useful questions exist.
- **Form:** Rejected generic capability; future implementation is environment
  and product-specific.
- **Required dependencies:** none for the rejected entry.
- **Conditional dependencies:** none. A separate future Product-specific
  warehouse capability may consume `AN-02` facts or source CDC after its own
  measured trigger and governance decision.
- **Blocked by:** generic starter warehouse/BI direction is rejected. A future
  product-specific warehouse after a measured trigger would be a separate
  capability with its own owner and contract.
- **Unlocks:** nothing in current starter.
- **Priority:** —.
- **Reasons to defer / non-goals:** не bundle ClickHouse/warehouse/dbt/BI,
  universal metric DSL or cross-product data lake into application starter.
- **Evidence:** current repository and named products operate without this
  platform.

### Сводка зависимостей

| Entry   | Required before implementation                                    | Conditional                                        |
| ------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `AN-01` | Metric owner, source facts, definition, freshness and rebuild     | Outbox, BullMQ, cache, `INT-07`                    |
| `AN-02` | Named metrics, fact schema/version, correction and retention      | Outbox, BullMQ, measured warehouse trigger         |
| `AN-03` | Report actor, metric dictionary, source completeness and snapshot | `AN-01/02`, `INT-07`, communications, AI narrative |
| `AN-04` | Event catalog, provider, identity/consent/retention/deletion      | Governance and selected server delivery            |
| `AN-05` | Rejected generic warehouse/BI/semantic layer                      | Future product capability is evaluated separately  |

`AN-01` is the only current candidate with repeated consumers, but repetition
proves a pattern, not one shared implementation. Technical metrics remain in
category 1; business audit in category 8; reports own definitions while
`INT-07` owns only bulk artifact delivery.

## 12. AI и automation

### Граница категории

Starter не содержит LLM SDK, model/provider config, embeddings, vector store,
MCP server or AI run persistence. AI capability не получает собственные права
на product data/actions: Identity определяет actor, module authorization —
доступ, category 8 — privacy/audit, category 9 — human decision, category 11 —
deterministic metrics, а AI остаётся decision-support or bounded adapter.

Amazing EKB является реальным первым consumer: отдельный local read-only MCP
package предоставляет allowlisted admin reads, маркирует imported material as
untrusted и сохраняет source references. Внешний AI client использует эти tools
и templates и формирует source-cited report, а human operator проверяет его и
вручную выполняет любое последующее действие; accepted report run ещё должен
дать отдельное evidence. Это сильный Product-specific Reference, но ещё не
generic AI platform.

### `AI-01`. Read-only AI-assisted discovery with cited human report

- **Entry kind:** Capability.
- **Catalog status:** Validated candidate.
- **What already exists:** вне starter Amazing EKB implements a local stdio MCP
  package with explicit backend allowlist, paginated complete reads, untrusted
  content wrapping, redacted errors, prompt/report/gate templates and manual
  runbook. Starter itself has only Auth/RBAC, OpenAPI and safe HTTP primitives.
- **What could be added:** maintained Product-specific Reference showing a
  bounded read tool surface, complete-versus-partial collection metadata,
  source-cited recommendations, duplicate/confidence/manual-review sections and
  an evaluation worksheet.
- **Named consumer:** Amazing EKB administrator discovering possible places from
  imported Telegram materials while all create/link/approve/reject actions stay
  in existing human admin workflows.
- **Failure model:** prompt injection from imported text, hallucinated facts,
  incomplete pagination presented as complete, lost source references,
  duplicate candidate, overconfident classification, secret/cookie leakage,
  unauthorized admin read and report mistaken for an executed mutation.
- **Form:** Product-specific Reference; read-tool mechanics become Kit only
  after another independent product repeats the security and collection
  contract.
- **Required dependencies:** named decision owner, authorized read API,
  allowlisted schemas/tools, untrusted-content boundary, source provenance,
  completeness metadata, report rubric and manual next action — Product-owned.
- **Conditional dependencies:** MCP as an adapter, external report destination
  such as Notion and category 11 evaluation summaries; none belongs in Core.
- **Blocked by:** extraction into starter requires measured POC usefulness, an
  accepted source-cited report run and a separate maintenance decision. A
  second reusable consumer is required only before promoting read-tool mechanics
  into a Kit; it does not block a Product-specific Reference.
- **Unlocks:** evidence for `AI-02`; safe experimentation without backend LLM or
  write capability.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не add backend LLM API, persistent candidate
  models, generic HTTP/shell/database tools or autonomous moderation; a report
  must never imply state change.
- **Evidence:** external Amazing EKB
  `docs/prd-mcp-ai-assisted-place-discovery-poc.md` and `tools/mcp/README.md` are
  named runtime/design evidence; starter absence is visible in
  [`package.json`](../package.json).

### `AI-02`. Durable AI suggestion and human-review lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** `AI-01` deliberately writes only a report and does
  not persist run/candidate state. Starter approval Reference demonstrates a
  separate human decision pattern but not AI suggestion semantics.
- **What could be added:** product-owned run snapshot, input/source fingerprint,
  prompt/rule/model version, candidate/evidence artifact, stale/outdated marker,
  human accept/reject/edit decision and explicit effect handoff.
- **Named consumer:** Amazing EKB productized place-discovery v1 only if the
  manual POC demonstrates useful quality and review-time reduction.
- **Failure model:** suggestion detached from source version, stale candidate
  accepted after data changes, rerun silently overwrites prior reasoning,
  duplicate candidates, human edit lost, model output stored as product truth
  and rejected PII retained indefinitely.
- **Form:** Product-specific workflow; reuse category 9 patterns conditionally,
  not a generic AI entity.
- **Required dependencies:** positive `AI-01` evaluation, immutable input
  provenance/fingerprint, product suggestion schema, human decision/effect
  contract and retention/privacy rules — Missing/Product-owned.
- **Conditional dependencies:** category 9 review state, category 4 background
  execution and category 11 evaluation/reporting.
- **Blocked by:** measured POC result and approved productized workflow.
- **Unlocks:** `AI-03` confirmed writes and reproducible product evaluation.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не persist chat transcripts by default, не
  build generic `AiSuggestion` table and не automate publication from confidence
  alone.
- **Evidence:** Amazing EKB POC rollout explicitly makes persistent discovery
  snapshots conditional on useful human evaluation.

### `AI-03`. Confirmed agent action with preview, idempotency and dual attribution

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** current verified AI consumer is read-only; starter
  has Auth/RBAC and approval Reference, but no machine/agent principal or write
  tool surface.
- **What could be added:** one named product command tool with exact typed
  payload, fresh authorization, human-visible preview, explicit confirmation,
  request idempotency, actor+agent attribution, bounded result and durable
  business audit.
- **Named consumer:** possible later Amazing EKB commands such as create hidden
  place or link/decide material after a reviewed candidate; none is approved for
  the current POC.
- **Failure model:** prompt injection invokes a tool, confused deputy crosses
  user scope, stale preview differs from execution, replay duplicates effect,
  partial result is retried blindly, approval applies to another payload and
  agent credentials obscure the responsible human.
- **Form:** Product-specific action adapters; common confirmation/idempotency
  mechanics may become Kit only after repeated safe commands.
- **Required dependencies:** named command/use case, human actor authorization,
  exact preview-to-payload binding, idempotent execution, dual attribution,
  durable audit and recovery — Missing/Product-owned.
- **Conditional dependencies:** category 9 approval for high-risk/asynchronous
  actions, `ORG-04/05` for a true machine principal, Outbox for follow-up work.
- **Blocked by:** successful read-only evaluation and separately approved first
  write action/threat model.
- **Unlocks:** bounded agent automation without generic write access.
- **Priority:** P2.
- **Reasons to defer / non-goals:** no generic HTTP, SQL, shell or filesystem
  tool; no blanket admin token, autonomous publish/delete, confirmation encoded
  only in natural language or permission bypass through an agent service.
- **Evidence:** Amazing EKB POC explicitly excludes write tools and lists later
  commands as a separate PRD/RFC boundary.

### `AI-04`. Persistent model invocation, attempt and cost lifecycle

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no backend LLM provider, prompt registry, model run,
  token/cost budget or retry state in starter. `AI-01` uses the user's external
  AI client subscription and therefore does not prove this server capability.
- **What could be added:** one task-specific invocation port and durable run:
  provider/model/prompt/schema version, deadline, attempts, cancellation,
  redacted outcome, token/cost usage and operator retry/disable procedure.
- **Named consumer:** absent; neither Amazing EKB POC nor DARTS v1 authorizes a
  backend model call.
- **Failure model:** timeout with charged/ambiguous completion, duplicate costly
  invocation, unbounded retry/token spend, provider fallback changes semantics,
  PII/secrets enter prompt/log, malformed structured result and cancellation
  ignored after shutdown.
- **Form:** task-specific Reference first; transport/budget Kit only after
  repeated provider-backed tasks.
- **Required dependencies:** named model task, selected provider/model, data-use
  policy, input/output schema, quality/cost/latency budget and outage behavior —
  Missing.
- **Conditional dependencies:** category 4 job lifecycle, category 11 metrics
  and multi-provider fallback only after measured need.
- **Blocked by:** first approved server-side LLM consumer and provider/data
  contract.
- **Unlocks:** reproducible asynchronous model tasks and later provider comparison.
- **Priority:** P2.
- **Reasons to defer / non-goals:** не add an OpenAI/Anthropic wrapper in Core,
  generic prompt repository, silent fallback or unlimited retries merely because
  an SDK exists.
- **Evidence:** no LLM dependency/config/model exists in
  [`package.json`](../package.json), [`runtime-environment.schema.ts`](../src/platform/config/runtime-environment.schema.ts)
  or [`schema.prisma`](../prisma/schema.prisma).

### `AI-05`. Permission-aware retrieval and RAG

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** ordinary PostgreSQL queries and Amazing EKB structured
  read tools; no document ingestion, chunk, embedding, vector index or retrieval
  citation contract. Structured API reads are not RAG.
- **What could be added:** product-specific corpus ingestion with document
  version/provenance, authorization-filtered retrieval, deletion/reindex, quoted
  citations and evaluation against known questions.
- **Named consumer:** отсутствует product knowledge assistant requiring semantic
  retrieval; place discovery operates on bounded structured material reads.
- **Failure model:** cross-user/organization data leak, stale or deleted chunks,
  prompt injection in corpus, citation not supporting answer, embedding/index
  drift, incomplete retrieval presented as truth and source retention violation.
- **Form:** Product-specific first; storage/vector adapters are implementation
  details, not a generic RAG platform.
- **Required dependencies:** named corpus/questions, document ownership/access,
  ingestion/version/deletion/provenance and retrieval quality evaluation —
  Missing.
- **Conditional dependencies:** category 7 document/search capability,
  organization scoping and `AI-04` model invocation.
- **Blocked by:** concrete knowledge consumer and authorized corpus.
- **Unlocks:** cited product knowledge answers for that corpus.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не install vector database, embeddings or
  generic crawler in starter; no access filtering after retrieval and no answer
  without evidence.
- **Evidence:** verified projects use structured reads/imports; no RAG runtime is
  present.

### `AI-06`. Predictive valuation and decision support

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** DARTS records a desired future property-price
  recommendation, but current product contract explicitly excludes it from v1
  and has no training/evaluation dataset.
- **What could be added:** separately researched product with target/outcome
  definition, legally usable comparable data, baseline, offline/online
  evaluation, uncertainty, drift monitoring and explicit human responsibility.
- **Named consumer:** possible later DARTS realtor valuation assistant; not an
  approved implementation slice.
- **Failure model:** biased/incomplete comparable data, leakage from future
  outcome, market drift, confident harmful recommendation, no explanation or
  uncertainty, user treats estimate as guarantee and source licensing forbids
  model use.
- **Form:** Product-specific only.
- **Required dependencies:** business decision/owner, ground truth and data
  rights, baseline, evaluation thresholds, human-use policy and monitoring —
  Missing.
- **Conditional dependencies:** `AI-04`, `AN-01/02` data, external market
  integrations and governance/privacy review.
- **Blocked by:** separate product/data/legal research and usable dataset.
- **Unlocks:** only the named valuation scenario.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не treat an LLM prompt as valuation model,
  не reuse operational database as training data without rights/evaluation and
  не generalize to automated financial decisions.
- **Evidence:** DARTS current `docs/product/prd.md` FR-033 records the direction
  as out-of-v1 external evidence.

### `AI-07`. Grounded customer-facing content draft generation

- **Entry kind:** Capability.
- **Catalog status:** Deferred.
- **What already exists:** no generation/publishing pipeline. DARTS mentions
  future advertisement analysis and automatic news feed, both outside v1.
- **What could be added:** one content-draft task with immutable source snapshot,
  grounded citations, model/prompt/style/schema version, duplicate signals and
  a bounded draft result. Human editorial decision, scheduling, publication and
  takedown remain downstream capabilities.
- **Named consumer:** possible later DARTS content/news workflow; no approved
  current editor, source set or publication channel.
- **Failure model:** fabricated/outdated claim, copyright/source misuse, prompt
  injection, missing citation, brand/style violation, duplicate/SEO-spam draft
  or draft/result metadata presented as an approved publication.
- **Form:** Product-specific AI draft-generation task.
- **Required dependencies:** named audience/editor, licensed sources,
  fact/style/schema rules and draft acceptance criteria — Missing.
- **Conditional dependencies:** `AI-04` and category 5 sources; category 9 owns
  editorial decision, while category 6 or a product publishing integration owns
  scheduling, delivery, correction and takedown.
- **Blocked by:** separate product scope, sources and accountable editor.
- **Unlocks:** a bounded grounded draft for a separately authorized editorial
  and publishing flow, not general autonomy.
- **Priority:** P3.
- **Reasons to defer / non-goals:** не publish automatically, не own editorial
  approval/takedown, не generate from arbitrary web content, не build generic
  CMS or silently replace human legal review.
- **Evidence:** DARTS FR-033/FR-034 records these as external out-of-v1 ideas.

### `AI-08`. Generic multi-provider AI gateway and autonomous agent platform

- **Entry kind:** Capability.
- **Catalog status:** Rejected.
- **What already exists:** no server-side provider integration and only one
  external read-only product POC.
- **What could be added:** nothing as a combined capability. `AI-01`–`AI-07`
  remain independent and consumer-owned.
- **Named consumer:** отсутствует product requiring generic chat, RAG, agents,
  generation, prediction, provider routing and evaluation in one runtime.
- **Failure model:** lowest-common-denominator API hides provider semantics,
  fallback changes safety/quality, generic tool access expands authority,
  budgets appear enforced while downstream calls escape them and platform
  maintenance precedes product value.
- **Form:** Rejected generic capability.
- **Required dependencies:** none.
- **Conditional dependencies:** future narrow `AI-04` Kit only after repeated
  server-side invocations.
- **Blocked by:** rejected direction, not missing code.
- **Unlocks:** nothing in current starter.
- **Priority:** —.
- **Reasons to defer / non-goals:** no autonomous agent runtime, universal model
  router, prompt marketplace, generic memory, vector platform or broad tool
  registry in Core.
- **Evidence:** current consumers prove one read-only decision-support flow, not
  a platform.

### Сводка зависимостей

| Entry   | Required before implementation                                      | Conditional                                         |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `AI-01` | Decision owner, allowlisted reads, provenance, completeness, rubric | MCP/report destination and evaluation summaries     |
| `AI-02` | Positive POC, input snapshot, suggestion schema, review/retention   | Workflow, jobs and evaluation                       |
| `AI-03` | Named command, auth, bound preview, idempotency, dual audit         | Approval, machine principal and Outbox              |
| `AI-04` | Model task/provider, schemas, data policy, quality/cost/outage      | Jobs, metrics and measured fallback                 |
| `AI-05` | Corpus/questions, access, ingestion/version/deletion and evaluation | Data/search, organization scope, model invocation   |
| `AI-06` | Decision owner, ground truth/data rights, baseline and monitoring   | Model runtime, analytics and integrations           |
| `AI-07` | Audience/editor, licensed sources, style/schema and draft criteria  | Model/source adapters; downstream editorial/publish |
| `AI-08` | Rejected combined platform                                          | Future narrow `AI-04` only after repetition         |

AI output never becomes authoritative business state by itself. Deterministic
product command validates and persists the effect; category 8 records durable
audit, category 9 owns human decision, category 11 owns evaluation metrics.
`AI-01` is the sole current validated candidate and remains read-only until its
own acceptance evidence supports the next capability.

## Как каталог развивается

1. Выбирается одна capability, а не вся категория целиком.
2. Проверяются named consumer и failure model.
3. Required dependencies проверяются рекурсивно.
4. Уже существующие механизмы отмечаются `Available`; условные добавляются
   только при соответствующем reliability contract.
5. Capability попадает в roadmap только после отдельного решения о дизайне и
   реализации.
6. После реализации, отказа или изменения evidence статус возвращается в этот
   каталог.

Общий platform contract извлекается после двух независимых consumers с
совпадающими semantics. Исключение допускается только для самостоятельно
полезного, runtime-inert Kit с production adapter, тестами и recovery
документацией, как описано в [roadmap](roadmap.md#north-star-opinionated-production-constructor).
