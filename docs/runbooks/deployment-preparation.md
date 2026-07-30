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

Repository readiness does not prove environment readiness. The repository may
have a verified GHCR artifact while Dokploy, network routes, PostgreSQL, Redis,
DNS/TLS and secret injection remain unavailable. CLI does not provision
infrastructure: it validates approved inputs and, only under an explicit
`--apply`, operates an already prepared application.

Use [`release-manifest.example.json`](release-manifest.example.json) as the
non-secret structure for a later release decision. The handoff must name the
protected real manifest path and the intended `promotion-evidence.json` and
`rollback-evidence.json` paths; it must not pre-create or claim those evidence
files.

Local Alloy, Loki, Tempo and Grafana are development-only services and are
**excluded from production deployment readiness**. Production telemetry needs
its own environment owner, endpoint decision and hosted evidence.

## Два режима применения

- **Fresh descendant:** до первой публикации Stage замените каждую
  starter-owned identity на target-owned identity. Starter-значения нельзя
  оставлять как fallback или совместимый alias.
- **Existing backend adoption:** сначала проведите аудит target, затем
  классифицируйте каждый контракт как `adopt` / `reconcile` / `reject`,
  сохраните product modules и module-local boundaries, атомарно замените
  identity и получите свежие доказательства именно target repository. Не
  создавайте второй deployment architecture или переходный dual-mode путь.

Оба режима сходятся к одним и тем же критериям repository readiness и
environment-input readiness. Дополнительный аудит существующего backend не
ослабляет ни один инвариант.

## Уровни готовности

- **Repository ready:** target repository прошёл собственную публикацию Stage
  через Trivy и OCI smoke; workflow run ID/URL связывает target Stage revision,
  одобренную target-owned пару immutable digest/revision и результаты package
  checks. Gate считается пройденным только по свежему успешному workflow target,
  а не по PR, локальной сборке или историческому evidence другого repository.
- **Environment inputs ready:** для domain/TLS/proxy, PostgreSQL roles,
  persistent Redis, auth secrets, telemetry, backup и будущего private
  authenticated GHCR pull записаны владельцы и конкретные ожидаемые non-secret
  значения либо ссылки на защищённые записи, содержащие эти значения. Ни один
  hosted resource при этом не считается созданным, настроенным или доступным.

Один уровень не доказывает другой. До перехода к Dokploy требуются оба.

Канонический flow разделён на фазы. Сначала выполните шаги 1–4 как
pre-publication prerequisites. Затем запустите target Stage workflow. Только
после его завершения выполняйте шаги 5–9, чтобы проверить опубликованный
artifact, закрыть package и environment evidence и сформировать readiness
record.

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

Не ограничивайте identity audit перечисленными ниже файлами. До изменения и
после него выполните repo-wide inventory конкретных starter literals:

```sh
git grep -n -I -E \
  'nest-js-starter|nest_js_starter|nest-js-starter\.invalid|DenisChernykh/nest-js-starter'
```

Классифицируйте каждое совпадение как target-owned replacement либо намеренно
сохранённую историческую ссылку с review reference. Проверка должна охватывать
как минимум repository/package/OCI identity, workflow и OCI smoke helpers,
runtime defaults и `.env.example`, public Problem Details namespace и OpenAPI
examples, development cookie name, Redis key/test identities, telemetry service
и tracer names, database/test fixtures и зависимые тесты. В runtime-bearing
source, workflows, scripts, active configuration и тестовых ожиданиях
непреднамеренных starter literals после адаптации оставаться не должно.

## Шаг 3. Адаптировать repository-owned контракты

Сверьте target с repo-wide identity inventory и текущими файлами из
[Source-of-truth map](#source-of-truth-map), затем адаптируйте только
repository-owned слой:

- Stage workflow публикует target GHCR identity и использует repository policy;
- production image собирается для `linux/amd64`, запускается non-root и содержит
  target-owned OCI source/revision labels;
- package scripts и OCI smoke проверяют target image, entrypoint, filesystem,
  non-root user и exact revision;
- `.env.example` содержит только безопасные development examples, а production
  contract задаётся runtime schema;
- public Problem Details namespace, development cookie и telemetry tracer names
  принадлежат target, а их tests/examples изменяются вместе с source;
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

Сначала определите состояние target package:

- если package ещё не существует, оператор не создаёт его вручную: первый
  успешный image push внутри workflow автоматически создаёт GHCR container
  package, даже если более поздний Trivy или OCI smoke затем остановит run;
- если package уже существует, до Stage run владелец package подтверждает его
  linkage с target repository, выдаёт этому repository Actions access с правом
  записи и проверяет visibility/organization policy. Job-scoped
  `packages: write` не заменяет package-level access.

После target Stage run шаг 5 повторно подтверждает repository linkage, Actions
access, visibility и organization policy и сохраняет evidence. При
неподтверждённом доступе существующего package workflow не запускают в расчёте
на диагностический failure.

Новый package в personal account по умолчанию private. Перевод package в public
— отдельное необратимое решение оператора: его нельзя выдавать за технический
шаг workflow. GitHub поддерживает anonymous pull для public GHCR package, но
текущий [Dokploy adapter](dokploy-deployment.md) всегда передаёт username и
password в `application.saveDockerProvider`. Поэтому public anonymous GHCR
находится вне текущего adapter contract до отдельной намеренной реализации.

Текущий поддерживаемый handoff использует private authenticated GHCR. Для
будущего pull потребуется dedicated identity и personal access token (classic),
ограниченный `read:packages`. Сам account должен получить read-доступ к private
package; для organization package token дополнительно авторизуют для SSO, если
это требует organization. Создавайте и передавайте эту identity и token только
позднее, в явно разрешённом окне настройки Dokploy. До первой Dokploy mutation
этими credentials выполняют authenticated pull одобренного exact digest из
изолированного Docker auth context и сверяют OCI revision. Не записывайте
identity credential, token value или registry password ни в этот runbook, ни в
readiness record.

Primary sources:

- [GitHub: Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [GitHub: Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub: Package access and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)

После выполнения pre-publication prerequisites шагов 1–4 запустите target Stage
workflow. Не переходите к шагу 5 до его завершения.

## Шаг 5. Проверить Trivy, OCI smoke и immutable digest

Проверьте единственный разрешённый порядок Stage publication:

- [ ] full repository gate;
- [ ] build non-root image для `linux/amd64`;
- [ ] push commit-SHA tag в target GHCR;
- [ ] scan action-produced digest с Trivy;
- [ ] fail при fixable `HIGH` / `CRITICAL` findings;
- [ ] pull того же digest из GHCR;
- [ ] OCI smoke для этого digest и exact revision;
- [ ] запись immutable digest/revision pair.
- [ ] Проверка GHCR repository linkage, Actions access, private visibility и
      organization policy с evidence references.

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

Строгий release manifest и CLI сохраняют operation-specific byte-for-byte pin
guard. Поэтому fresh descendant и `backend-codex` после получения собственного
Stage evidence, но до любой будущей Dokploy mutation обязаны записать в
target-owned protected manifest две независимые пары:

- candidate image digest и его exact Stage/OCI revision из нового успешного
  target workflow;
- отдельный previous image digest и его revision, ранее успешно проверенные и
  подтверждённые как совместимые с текущей database schema для rollback.

Candidate и rollback не могут ссылаться на один образ. Если отдельного
совместимого previous image ещё нет, rollback readiness не подтверждена и
promotion запрещён. Historical pins starter нельзя использовать как target
defaults, переносить в readiness record или принимать как повторно используемое
evidence. Ревью обеих пар и schema-compatibility evidence входят в readiness
record; строгую manifest validation удалять или ослаблять нельзя.

## Шаг 6. Подготовить production configuration contract

Зафиксируйте владельца и expected non-secret semantics для всех runtime inputs.
В этом runbook оставьте только имена переменных; конкретные non-secret значения
поместите в readiness record либо в доступную владельцу защищённую input record:

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
- `SERVICE_REVISION` ровно один раз присутствует в complete runtime environment
  и byte-for-byte равен Stage revision и
  `org.opencontainers.image.revision` одобренного digest;
- coordination Redis не использует logical database selection;
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
- будущий GHCR pull mode: private authenticated с dedicated least-privilege
  identity; public anonymous pull не поддерживается текущим Dokploy adapter.

Сверьте эти решения с [deployment security runbook](deployment-security.md).
Не публикуйте DNS record, не заказывайте certificate, не открывайте network port
и не создавайте Dokploy application на этом шаге.

## Шаг 9. Сформировать redacted readiness record

Скопируйте шаблон ниже в одобренное место для deployment evidence только после
получения соответствующих доказательств. Не заменяйте `passed/failed` на
`passed`, пока нет свежего успешного target workflow.

## Readiness record

- Target repository:
- Protected release manifest path and approval reference:
- Intended promotion evidence path:
- Intended rollback evidence path:
- Target identity manifest reference:
- Repo-wide starter identity inventory and retained-literal allowlist reference:
- GHCR package state before Stage: absent/existing; pre-publication access evidence if existing:
- Stage workflow run ID/URL:
- Stage revision:
- Approved GHCR image@digest:
- OCI revision label:
- Full gate result and evidence reference:
- Trivy HIGH/CRITICAL result and evidence reference:
- Pull-same-digest OCI smoke result and evidence reference:
- GHCR repository linkage check and evidence reference:
- GHCR Actions access check and evidence reference:
- GHCR visibility: private; owner and evidence reference:
- GitHub organization policy check and evidence reference:
- Target-owned candidate digest/revision review reference:
- Target-owned rollback digest/revision and schema-compatibility review reference:
- SERVICE_REVISION = Stage revision = OCI revision evidence reference:
- Runtime configuration contract owner:
- Runtime non-secret expected values/reference:
- PostgreSQL role contract owner:
- PostgreSQL database/migrator/runtime role names/reference:
- Coordination Redis durability owner:
- Redis key prefix and durability inputs/reference:
- Domain/TLS/proxy input owner:
- Public origin/browser origins/trusted proxy CIDRs/reference:
- Auth secret provider and four-secret contract owner/reference:
- Telemetry decision owner:
- Telemetry enabled/disabled input/reference:
- Backup/restore policy owner:
- Backup target/prefix/schedule/retention/restore inputs/reference:
- Future GHCR pull identity owner and authorized creation-window reference:
- Future pull identity package-read grant/SSO authorization evidence reference:
- Authenticated pull of approved digest and OCI revision evidence reference:
- Remaining hosted prerequisites:

Поля содержат только identifiers, результаты, owner names, конкретные
non-secret values или ссылки на защищённые deployment records. Connection URLs,
credentials, token values, registry passwords и secret values запрещены.
Public origins и telemetry endpoint указывайте ссылкой на защищённую input
record, если выбранное место readiness record не предназначено для таких
адресов. Пустое обязательное поле, ссылка без доступного владельцу record либо
несовпадение revision/digest означает, что соответствующий уровень не готов.

## Stop gate перед Dokploy

Остановитесь перед Dokploy, если readiness record не содержит workflow run
ID/URL для exact target Stage revision, совпадающую пару image digest/OCI
revision, ссылки на успешные full gate, Trivy и pull-same-digest OCI smoke,
результаты repository linkage, Actions access, private visibility и
organization policy checks, repo-wide identity inventory без непреднамеренных
starter literals, две независимые review-approved candidate и rollback
digest/revision пары, rollback schema-compatibility evidence и доказательство
равенства `SERVICE_REVISION` Stage/OCI revision. Для каждого environment input
обязательны владелец и конкретное non-secret значение либо доступная защищённая
record reference. Dedicated future GHCR pull identity и окно создания PAT
classic с `read:packages` должны иметь владельца; сам credential до этого окна
не создаётся и не записывается. В разрешённом окне, но до первой Dokploy
mutation, readiness record дополняется evidence package read grant, SSO
authorization при необходимости и authenticated pull одобренного digest с
проверкой OCI revision.

Не делайте вывод, что Dokploy, VPS, DNS, PostgreSQL, Redis, telemetry или S3
существует. Historical starter pins и evidence не закрывают ни одно из этих
условий.

Продолжать разрешено только позднее, по
[Dokploy deployment runbook](dokploy-deployment.md) и только при явной
авторизации hosted-операций. Эта передача не расширяет исходную authority:
любая mutation требует отдельного разрешённого окна.

## Source-of-truth map

Focused runbooks и repository files остаются authoritative; этот документ
только задаёт orchestration и stop gates.

| Contract                                              | Authoritative source                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage order, permissions and target GHCR identity     | [`.github/workflows/stage-image.yml`](../../.github/workflows/stage-image.yml)                                                                                                                                 |
| Platform, non-root runtime, entrypoint and OCI labels | [`Dockerfile`](../../Dockerfile)                                                                                                                                                                               |
| Local OCI checks and smoke behavior                   | [`package.json`](../../package.json), [`scripts/oci/run-image-smoke.ts`](../../scripts/oci/run-image-smoke.ts)                                                                                                 |
| Runtime input examples and validation                 | [`.env.example`](../../.env.example), [`src/platform/config/runtime-environment.schema.ts`](../../src/platform/config/runtime-environment.schema.ts)                                                           |
| Public problem identity and examples                  | [`src/platform/http/errors/problem-registry.ts`](../../src/platform/http/errors/problem-registry.ts), [`src/platform/http/docs/problem-response.dto.ts`](../../src/platform/http/docs/problem-response.dto.ts) |
| Development cookie and Redis telemetry identity       | [`src/platform/config/runtime-environment.ts`](../../src/platform/config/runtime-environment.ts), [`src/platform/redis/redis-command.executor.ts`](../../src/platform/redis/redis-command.executor.ts)         |
| PostgreSQL migrator/runtime role separation           | [`deployment-database-roles.md`](deployment-database-roles.md)                                                                                                                                                 |
| Public perimeter, credentials and Redis durability    | [`deployment-security.md`](deployment-security.md)                                                                                                                                                             |
| PostgreSQL backup ownership and isolated restore      | [`postgres-backup-restore.md`](postgres-backup-restore.md)                                                                                                                                                     |
| Stage publication semantics                           | [`stage-image-publication.md`](stage-image-publication.md)                                                                                                                                                     |
| Redis-loss procedure                                  | [`coordination-redis-loss.md`](coordination-redis-loss.md)                                                                                                                                                     |
| Secret-compromise procedure                           | [`session-secret-compromise.md`](session-secret-compromise.md)                                                                                                                                                 |
| Telemetry-loss procedure                              | [`telemetry-collector-loss.md`](telemetry-collector-loss.md)                                                                                                                                                   |
| Later hosted deployment adapter                       | [`dokploy-deployment.md`](dokploy-deployment.md)                                                                                                                                                               |
