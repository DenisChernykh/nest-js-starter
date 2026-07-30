# Подготовка backend к будущему deployment

## Назначение и граница

Этот runbook — единая точка входа для подготовки repository-owned контрактов и
набора входных данных для будущего deployment. Он не устанавливает и не
настраивает Dokploy, не выполняет deployment и не изменяет VPS, DNS, database
(включая PostgreSQL), Redis, telemetry или S3. В рамках подготовки запрещено
создавать либо изменять hosted-ресурсы, генерировать или вводить реальные
credentials и объявлять окружение уже provisioned.

Результат работы — два независимо принимаемых уровня готовности и redacted
readiness record. Подробные команды, проверки и failure handling остаются в
focused runbooks из [Source-of-truth map](#source-of-truth-map).

## Два режима применения

```text
Fresh descendant:
replace every starter-owned identity before the first Stage publication.

Existing backend adoption:
audit the target, classify each contract as adopt/reconcile/reject, preserve
product modules, replace identity atomically, and require fresh target evidence.
```

**Fresh descendant:** до первой публикации Stage замените каждую
starter-owned identity на target-owned identity. Starter-значения нельзя
оставлять как fallback или совместимый alias.

**Existing backend adoption:** сначала проведите аудит target, затем
классифицируйте каждый контракт как `adopt` / `reconcile` / `reject`, сохраните
product modules и module-local boundaries, атомарно замените identity и получите
свежие доказательства именно target repository. Не создавайте второй deployment
architecture или переходный dual-mode путь.

Оба режима сходятся к одним и тем же критериям repository readiness и
environment-input readiness. Дополнительный аудит существующего backend не
ослабляет ни один инвариант.

## Уровни готовности

```text
Repository ready:
the target repository has passed its own Stage publication through Trivy and
OCI smoke and has an approved target-owned digest/revision pair.

Environment inputs ready:
owners and non-secret expected values are recorded for domain/TLS/proxy,
PostgreSQL roles, persistent Redis, auth secrets, telemetry, backup, and future
GHCR pull access; hosted resources are not claimed as provisioned.
```

**Repository ready:** target repository прошёл собственную публикацию Stage
через Trivy и OCI smoke; для него зафиксирована одобренная target-owned пара
immutable digest/revision. Gate считается пройденным только по свежему успешному
workflow target, а не по PR, локальной сборке или историческому evidence другого
repository.

**Environment inputs ready:** для domain/TLS/proxy, PostgreSQL roles,
persistent Redis, auth secrets, telemetry, backup и будущего GHCR pull access
записаны владельцы и ожидаемые non-secret значения. Ни один hosted resource при
этом не считается созданным, настроенным или доступным.

Один уровень не доказывает другой. До перехода к Dokploy требуются оба.

## Шаг 1. Зафиксировать authority и target identity

До любых изменений зафиксируйте человека, который разрешил подготовку, точный
target repository и следующую identity manifest:

| Input                  | Target-owned value to record                            | Source to inspect        |
| ---------------------- | ------------------------------------------------------- | ------------------------ |
| GitHub repository      | `<github-owner>/<repository-name>`                      | `git remote -v`          |
| Source URL             | `https://github.com/<github-owner>/<repository-name>`   | OCI source contract      |
| Stage branch           | `stage`                                                 | repository policy        |
| GHCR image             | `ghcr.io/<github-owner>/<repository-name>` in lowercase | Stage workflow           |
| OCI title              | target service name                                     | `Dockerfile`             |
| Service identity       | service name, version and revision source               | `.env.example`           |
| Public boundary        | future HTTPS API URL and browser origins                | environment schema       |
| Redis namespace        | target-owned key prefix                                 | environment schema       |
| PostgreSQL identities  | target database, migrator and runtime roles             | database-role runbook    |
| Backup ownership       | future bucket/prefix owner and retention owner          | backup runbook           |
| Deployment environment | human-owned non-production/production name              | future operator decision |

Значения в угловых скобках — символические примеры структуры, а не значения для
копирования. Не заменяйте их догадками. В manifest и readiness record не
записывайте credentials, connection URLs, registry passwords или secret
values.

Identity считается target-owned только после сверки с checkout, repository
policy и назначенным владельцем. Source URL должен быть credential-free HTTPS
URL, GHCR image — lowercase-производной от target GitHub repository, OCI title,
service identity, Redis prefix, PostgreSQL identities и backup ownership —
именами target, а не starter.

## Шаг 2. Провести аудит существующего backend

Для `backend-codex` до редактирования обязательно исследуйте:

- точный checkout, текущие branch и HEAD, dirty state и remotes;
- workflows и существующие GitHub organization policies;
- `Dockerfile`, package scripts и OCI smoke implementation;
- runtime environment schema и его production validation;
- migrations, PostgreSQL ownership и role model;
- существующие registry packages и их linkage/access/visibility;
- product-local infrastructure, lifecycle и module-local boundaries.

Сохраните product modules. Не заменяйте их demo CRUD, generic
repository/controller/service abstraction или starter-specific infrastructure.
Каждый repository-owned контракт классифицируйте без неоднозначности:

```text
adopt = target capability is absent; port and rename it for the target
reconcile = target already has an equivalent capability; retain it only after
            proving every invariant
reject = do not copy starter identity, digest, URL, secret, historical evidence,
         or obsolete compatibility path
```

- `adopt` — target capability отсутствует; перенесите её и переименуйте для
  target;
- `reconcile` — у target уже есть эквивалентная capability; сохраните её только
  после доказательства каждого инварианта;
- `reject` — не копируйте starter identity, digest, URL, secret, historical
  evidence или obsolete compatibility path.

Сначала составьте полную карту классификации, затем примените согласованный
набор атомарно. Частичная замена, при которой одновременно живут starter и
target identities, не принимается. Starter CI, digest или deployment evidence
никогда не подтверждают готовность `backend-codex`.

Для fresh descendant используйте тот же аудит source-of-truth контрактов, но
отсутствующие product-local части не изобретайте: замените все starter-owned
identity до первой Stage publication.

## Шаг 3. Адаптировать repository-owned контракты

Сверьте target с текущими файлами из [Source-of-truth map](#source-of-truth-map)
и адаптируйте только repository-owned слой:

- Stage workflow публикует target GHCR identity и использует repository policy;
- production image собирается для `linux/amd64`, запускается non-root и содержит
  target-owned OCI source/revision labels;
- package scripts и OCI smoke проверяют target image, entrypoint, filesystem,
  non-root user и exact revision;
- `.env.example` содержит только безопасные development examples, а production
  contract задаётся runtime schema;
- migrations и role contracts сохраняют product schema и разделение migrator /
  runtime;
- Redis key prefix заменяется один раз на target-owned значение и затем остаётся
  неизменным.

Не копируйте version pins из этого prose. Для каждого действия и action
используйте точную текущую pin/version из target source-of-truth файла. Не
коммитьте credentials, production connection URLs или generated evidence.

Применяйте изменения через обычный pull request в `stage` согласно repository
policy. PR gate сам по себе не публикует и не одобряет image.

## Шаг 4. Подготовить GitHub Actions и первую публикацию GHCR

Перед merge в `stage` владелец repository подтверждает:

- GitHub Actions включены;
- organization policy разрешает используемые pinned actions и публикацию
  packages;
- Stage job получает job-scoped `contents: read` и `packages: write`;
- workflow использует автоматически выданный `GITHUB_TOKEN`, а не созданный
  вручную secret;
- image name выводится из lowercased target `GITHUB_REPOSITORY`.

Первый успешный push workflow автоматически создаёт GHCR container package.
Оператор не создаёт package заранее вручную. После первой публикации отдельно
проверьте repository linkage, Actions access, visibility и organization policy.

Новый package в personal account по умолчанию private. Перевод package в public
— отдельное необратимое решение оператора: его нельзя выдавать за технический
шаг workflow. Public GHCR package можно pull анонимно.

Для будущего pull private package из Dokploy потребуется dedicated identity и
personal access token (classic), ограниченный `read:packages`. Создавайте этот
token только позднее, в явно разрешённом окне настройки Dokploy. Не записывайте
token value или registry password ни в этот runbook, ни в readiness record.

Primary sources:

- [GitHub: Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub: Package access and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)

## Шаг 5. Проверить Trivy, OCI smoke и immutable digest

Единственный разрешённый порядок Stage publication:

```text
full repository gate
-> build linux/amd64 non-root image
-> push commit-SHA tag to target GHCR
-> scan the action-produced digest with Trivy
-> fail on fixable HIGH/CRITICAL findings
-> pull the same digest from GHCR
-> run OCI smoke against that digest and exact revision
-> record the digest/revision pair
```

- [ ] Пройти full repository gate.
- [ ] Собрать non-root image для `linux/amd64`.
- [ ] Push commit-SHA tag в target GHCR.
- [ ] Просканировать action-produced digest с Trivy.
- [ ] Завершить workflow ошибкой при fixable `HIGH` / `CRITICAL` findings.
- [ ] Pull тот же digest из GHCR.
- [ ] Запустить OCI smoke для этого digest и exact revision.
- [ ] Записать immutable digest/revision pair.

`ignore-unfixed: true` исключает findings, для которых нет известного fix. Это
не превращает оставшийся fixable `HIGH` или `CRITICAL` finding в успех. Перед
каждым adoption сверяйте текущий pinned Trivy action, scanners, severity,
`ignore-unfixed` и exit behavior непосредственно с target workflow; не
копируйте action version из prose.

Fail-closed правила:

- PR gate не публикует и не одобряет image;
- `pnpm oci:check` доказывает локальный image, но не GHCR artifact;
- digest, который был push, но принадлежит провалившемуся Trivy или OCI smoke
  run, существует, но не одобрен;
- tag, включая commit-SHA tag, не является deployment reference;
- только immutable digest из успешного target workflow может быть кандидатом на
  deployment;
- starter CI/digest evidence не может одобрить `backend-codex`.

Одобренная запись связывает digest с exact revision и успешным workflow run.
Если любая часть цепочки отсутствует либо относится к другому source revision,
repository readiness остаётся неподтверждённой.

## Шаг 6. Подготовить production configuration contract

Зафиксируйте владельца и expected non-secret semantics для всех runtime inputs,
не записывая значения:

```text
NODE_ENV
LOG_LEVEL
OTEL_SERVICE_NAME
SERVICE_VERSION
SERVICE_REVISION
OTEL_SDK_DISABLED
OTEL_EXPORTER_OTLP_ENDPOINT
API_HOST
API_PORT
API_DOCS_MODE
PUBLIC_API_URL
CORS_ORIGINS
TRUST_PROXY_CIDRS
DATABASE_URL
DATABASE_POOL_MAX
REDIS_COORDINATION_URL
REDIS_KEY_PREFIX
AUTH_SESSION_KEY_SECRET
AUTH_CSRF_SECRET
AUTH_RATE_LIMIT_KEY_SECRET
AUTH_NETWORK_METADATA_SECRET
```

Repository preparation проверяет schema и ownership, но не выполняет future
secret injection. Production contract требует:

- `NODE_ENV=production`;
- `API_DOCS_MODE` равен `protected` или `off`;
- public API и CORS origins используют HTTPS;
- `TRUST_PROXY_CIDRS` непуст и принадлежит конкретному environment;
- coordination Redis использует не logical database selection;
- четыре auth secrets независимы друг от друга, каждый является 32-byte
  base64url value и хранится только в будущем secret provider;
- telemetry либо имеет назначенного владельца endpoint, либо сознательно
  отключена с записанным владельцем решения.

Не помещайте secret slots или реальные expected secret values в readiness
record. Проверки production schema не доказывают, что secret provider,
telemetry collector или reverse proxy уже существует.

## Шаг 7. Зафиксировать PostgreSQL, Redis и backup contracts

PostgreSQL:

- one-shot migrator получает `MIGRATION_DATABASE_URL`, отображённый в
  process-owned `DATABASE_URL`;
- API получает `RUNTIME_DATABASE_URL`, отображённый в его process-owned
  `DATABASE_URL`;
- API runtime никогда не получает migrator credential;
- runtime role имеет application DML и sequence access, но не DDL, изменение
  migration history, ownership или dangerous role flags.

Подробные provisioning и verification команды находятся в
[PostgreSQL role runbook](deployment-database-roles.md). Repository preparation
только фиксирует target database/role identities и владельца будущей операции.

Coordination Redis содержит authoritative persistent session/rate-limit state,
а не disposable cache. Для будущего environment зафиксируйте владельца:

- persistent storage и AOF;
- `noeviction`;
- least-privilege ACL;
- backup и restore evidence;
- одного неизменного target-owned `REDIS_KEY_PREFIX`.

Ни deployment, ни recovery не выполняет `FLUSHDB` / `FLUSHALL`. Подробности
находятся в [security baseline](deployment-security.md) и
[coordination Redis loss runbook](coordination-redis-loss.md).

Backup policy должен иметь явного владельца, off-host target, retention и
изолированный restore drill. Не считайте bucket, credentials, schedule или
restore environment уже созданными. Подробные команды находятся в
[PostgreSQL backup and isolated restore runbook](postgres-backup-restore.md).

Security incident и telemetry failure procedures не дублируются здесь:

- [session secret compromise](session-secret-compromise.md);
- [telemetry collector loss](telemetry-collector-loss.md).

## Шаг 8. Подготовить будущие public perimeter inputs

Без изменений DNS, VPS или proxy запишите владельцев и ожидаемые non-secret
inputs:

- controlled domain и точный будущий HTTPS public API origin;
- конечный набор HTTPS browser origins;
- TLS termination owner, certificate/hostname policy и HTTP-to-HTTPS policy;
- непустой список environment-owned trusted proxy CIDRs;
- private network boundary между reverse proxy и API;
- будущий GHCR pull mode: anonymous для public package либо dedicated
  least-privilege identity для private package.

Сверьте эти решения с [deployment security runbook](deployment-security.md).
Не публикуйте DNS record, не заказывайте certificate, не открывайте network port
и не создавайте Dokploy application на этом шаге.

## Шаг 9. Сформировать redacted readiness record

Скопируйте шаблон ниже в одобренное место для deployment evidence только после
получения соответствующих доказательств. Не заменяйте `passed/failed` на
`passed`, пока нет свежего успешного target workflow.

## Readiness record

- Target repository:
- Stage revision:
- Approved GHCR digest:
- OCI revision label:
- Full gate: passed/failed
- Trivy HIGH/CRITICAL gate: passed/failed
- Pull-by-digest smoke: passed/failed
- GHCR visibility/access policy: private/public and owner
- Runtime configuration contract owner:
- PostgreSQL role contract owner:
- Coordination Redis durability owner:
- Domain/TLS/proxy input owner:
- Telemetry decision owner:
- Backup/restore policy owner:
- Remaining hosted prerequisites:

После каждого двоеточия допустимы только identifiers, status или owner names.
Connection URLs, credentials, token values, registry passwords и secret values
запрещены. Пустой owner означает, что соответствующий input не готов.

## Stop gate перед Dokploy

```text
Stop before Dokploy unless repository readiness has fresh target evidence and
every environment input has a named owner. Do not infer that Dokploy, VPS, DNS,
PostgreSQL, Redis, telemetry, or S3 exists. Continue later with
docs/runbooks/dokploy-deployment.md only under explicit hosted-operation
authorization.
```

Остановитесь перед Dokploy, если repository readiness не имеет свежего target
evidence либо хотя бы у одного environment input нет назначенного владельца. Не
делайте вывод, что Dokploy, VPS, DNS, PostgreSQL, Redis, telemetry или S3
существует.

Продолжать разрешено только позднее, по
[Dokploy deployment runbook](dokploy-deployment.md) и только при явной
авторизации hosted-операций. Эта передача не расширяет исходную authority:
любая mutation требует отдельного разрешённого окна.

## Source-of-truth map

Focused runbooks и repository files остаются authoritative; этот документ
только задаёт orchestration и stop gates.

| Contract | Authoritative source |
| --- | --- |
| Stage order, permissions and target GHCR identity | [`.github/workflows/stage-image.yml`](../../.github/workflows/stage-image.yml) |
| Platform, non-root runtime, entrypoint and OCI labels | [`Dockerfile`](../../Dockerfile) |
| Local OCI checks and smoke behavior | [`package.json`](../../package.json), [`scripts/oci/run-image-smoke.ts`](../../scripts/oci/run-image-smoke.ts) |
| Runtime input examples and validation | [`.env.example`](../../.env.example), [`src/platform/config/runtime-environment.schema.ts`](../../src/platform/config/runtime-environment.schema.ts) |
| PostgreSQL migrator/runtime role separation | [`deployment-database-roles.md`](deployment-database-roles.md) |
| Public perimeter, credentials and Redis durability | [`deployment-security.md`](deployment-security.md) |
| PostgreSQL backup ownership and isolated restore | [`postgres-backup-restore.md`](postgres-backup-restore.md) |
| Stage publication semantics | [`stage-image-publication.md`](stage-image-publication.md) |
| Redis-loss procedure | [`coordination-redis-loss.md`](coordination-redis-loss.md) |
| Secret-compromise procedure | [`session-secret-compromise.md`](session-secret-compromise.md) |
| Telemetry-loss procedure | [`telemetry-collector-loss.md`](telemetry-collector-loss.md) |
| Later hosted deployment adapter | [`dokploy-deployment.md`](dokploy-deployment.md) |
