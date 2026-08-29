/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'bootstrap-must-not-import-database-drivers',
      severity: 'error',
      from: { path: '(^|/)bootstrap(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?(@prisma/|pg(/|$))|(^|/)generated/prisma(/|$)',
      },
    },
    {
      name: 'bootstrap-must-import-modules-through-composition',
      severity: 'error',
      from: { path: '(^|/)bootstrap(/|$)' },
      to: {
        path: [
          '(^|/)modules/[^/]+/(domain|application|infrastructure|presentation)(/|$)',
          '(^|/)modules/[^/]+/.+/(domain|application|infrastructure|presentation)(/|$)',
        ],
      },
    },
    {
      name: 'module-public-api-must-not-export-domain',
      severity: 'error',
      from: { path: '(^|/)modules/[^/]+/index\\.ts$' },
      to: {
        path: [
          '(^|/)modules/[^/]+/domain(/|$)',
          '(^|/)modules/[^/]+/.+/domain(/|$)',
        ],
      },
    },
    {
      name: 'bootstrap-must-not-import-identity-access-internals',
      severity: 'error',
      comment:
        'Bootstrap may wire IdentityAccessModule, but must not reach into its capabilities or public contracts.',
      from: { path: '(^|/)bootstrap(/|$)' },
      to: {
        path: [
          '(^|/)modules/identity-access/(identity|sessions|authentication|authorization|account-lifecycle|account-administration|public-contracts)(/|$)',
          '(^|/)modules/identity-access/index\\.(?:[cm]?[jt]s)$',
        ],
      },
    },
    {
      name: 'identity-access-public-root-must-export-public-contracts-only',
      severity: 'error',
      comment:
        'The identity-access root entrypoint is a stable public API, not a shortcut into internal capabilities.',
      from: {
        path: '(^|/)modules/identity-access/index\\.(?:[cm]?[jt]s)$',
      },
      to: {
        path: '(^|/)modules/identity-access/(?!public-contracts(?:/|$))',
      },
    },
    {
      name: 'identity-access-public-contracts-must-not-import-internals',
      severity: 'error',
      comment:
        'Public contracts own their stable types and decorators and must not smuggle internal capability dependencies through the root.',
      from: {
        path: '(^|/)modules/identity-access/public-contracts(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(identity|sessions|authentication|authorization|account-lifecycle|account-administration|composition)(/|$)',
      },
    },
    {
      name: 'identity-access-external-consumers-must-use-public-root',
      severity: 'error',
      comment:
        'Other business modules consume identity-access only through modules/identity-access/index.ts.',
      from: { path: '(^|/)modules/(?!identity-access(?:/|$))' },
      to: {
        path: '(^|/)modules/identity-access/(?!index\\.(?:[cm]?[jt]s)$)',
      },
    },
    {
      name: 'identity-access-dag-identity-is-foundational',
      severity: 'error',
      comment:
        'Identity is the dependency leaf and must not depend on higher identity-access capabilities.',
      from: {
        path: '(^|/)modules/identity-access/identity(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(sessions|authentication|authorization|account-lifecycle|account-administration)(/|$)',
      },
    },
    {
      name: 'identity-access-dag-sessions-depend-only-on-identity',
      severity: 'error',
      comment:
        'Sessions may depend on Identity, but not on authentication, authorization or account workflows.',
      from: {
        path: '(^|/)modules/identity-access/sessions(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(authentication|authorization|account-lifecycle|account-administration)(/|$)',
      },
    },
    {
      name: 'identity-access-dag-authentication-depends-only-on-sessions',
      severity: 'error',
      comment:
        'Authentication uses the Sessions boundary and must not bypass it or depend on higher capabilities.',
      from: {
        path: '(^|/)modules/identity-access/authentication(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(identity|authorization|account-lifecycle|account-administration)(/|$)',
      },
    },
    {
      name: 'identity-access-dag-authorization-depends-only-on-sessions',
      severity: 'error',
      comment:
        'Authorization derives the principal through Sessions and stays independent from authentication and account workflows.',
      from: {
        path: '(^|/)modules/identity-access/authorization(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(identity|authentication|account-lifecycle|account-administration)(/|$)',
      },
    },
    {
      name: 'identity-access-dag-account-lifecycle-must-not-depend-on-administration',
      severity: 'error',
      comment:
        'Self-service account lifecycle may orchestrate authentication, sessions and authorization, but not operator administration.',
      from: {
        path: '(^|/)modules/identity-access/account-lifecycle(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(identity|account-administration)(/|$)',
      },
    },
    {
      name: 'identity-access-dag-account-administration-must-not-depend-on-lifecycle',
      severity: 'error',
      comment:
        'Operator administration depends on Sessions and Authorization, not on self-service lifecycle or authentication internals.',
      from: {
        path: '(^|/)modules/identity-access/account-administration(/|$)',
      },
      to: {
        path: '(^|/)modules/identity-access/(identity|authentication|account-lifecycle)(/|$)',
      },
    },
    {
      name: 'identity-access-sessions-must-not-deep-import-identity-adapters',
      severity: 'error',
      comment:
        'Sessions may consume Identity application contracts; adapters and delivery layers remain private.',
      from: {
        path: [
          '(^|/)modules/identity-access/sessions/(domain|application|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/sessions/.+/(domain|application|infrastructure|presentation)(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/identity/(domain|infrastructure|presentation|composition)(/|$)',
          '(^|/)modules/identity-access/identity/.+/(domain|infrastructure|presentation|composition)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-auth-capabilities-must-not-deep-import-session-adapters',
      severity: 'error',
      comment:
        'Authentication and Authorization may consume Sessions application contracts; adapters and delivery layers remain private.',
      from: {
        path: [
          '(^|/)modules/identity-access/(authentication|authorization)/(domain|application|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/(authentication|authorization)/.+/(domain|application|infrastructure|presentation)(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/sessions/(domain|infrastructure|presentation|composition)(/|$)',
          '(^|/)modules/identity-access/sessions/.+/(domain|infrastructure|presentation|composition)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-account-lifecycle-must-not-deep-import-capability-adapters',
      severity: 'error',
      comment:
        'Account Lifecycle orchestrates exported application contracts, never another capability adapter or delivery layer.',
      from: {
        path: [
          '(^|/)modules/identity-access/account-lifecycle/(domain|application|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/account-lifecycle/.+/(domain|application|infrastructure|presentation)(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/(authentication|sessions|authorization)/(domain|infrastructure|presentation|composition)(/|$)',
          '(^|/)modules/identity-access/(authentication|sessions|authorization)/.+/(domain|infrastructure|presentation|composition)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-account-administration-must-not-deep-import-capability-adapters',
      severity: 'error',
      comment:
        'Account Administration orchestrates exported Sessions and Authorization contracts, never their adapters or delivery layers.',
      from: {
        path: [
          '(^|/)modules/identity-access/account-administration/(domain|application|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/account-administration/.+/(domain|application|infrastructure|presentation)(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/(sessions|authorization)/(domain|infrastructure|presentation|composition)(/|$)',
          '(^|/)modules/identity-access/(sessions|authorization)/.+/(domain|infrastructure|presentation|composition)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-sessions-composition-must-not-import-identity-implementation',
      severity: 'error',
      comment:
        'Sessions composition may import Identity composition and application contracts, not its private implementation.',
      from: {
        path: [
          '(^|/)modules/identity-access/sessions/composition(/|$)',
          '(^|/)modules/identity-access/sessions/.+/composition(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/identity/(domain|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/identity/.+/(domain|infrastructure|presentation)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-auth-composition-must-not-import-session-implementation',
      severity: 'error',
      comment:
        'Authentication and Authorization composition may import Sessions composition and application contracts, not its private implementation.',
      from: {
        path: [
          '(^|/)modules/identity-access/(authentication|authorization)/composition(/|$)',
          '(^|/)modules/identity-access/(authentication|authorization)/.+/composition(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/sessions/(domain|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/sessions/.+/(domain|infrastructure|presentation)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-account-lifecycle-composition-must-not-import-capability-implementation',
      severity: 'error',
      comment:
        'Account Lifecycle composition imports capability modules and application contracts, not private implementations.',
      from: {
        path: [
          '(^|/)modules/identity-access/account-lifecycle/composition(/|$)',
          '(^|/)modules/identity-access/account-lifecycle/.+/composition(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/(authentication|sessions|authorization)/(domain|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/(authentication|sessions|authorization)/.+/(domain|infrastructure|presentation)(/|$)',
        ],
      },
    },
    {
      name: 'identity-access-account-administration-composition-must-not-import-capability-implementation',
      severity: 'error',
      comment:
        'Account Administration composition imports capability modules and application contracts, not private implementations.',
      from: {
        path: [
          '(^|/)modules/identity-access/account-administration/composition(/|$)',
          '(^|/)modules/identity-access/account-administration/.+/composition(/|$)',
        ],
      },
      to: {
        path: [
          '(^|/)modules/identity-access/(sessions|authorization)/(domain|infrastructure|presentation)(/|$)',
          '(^|/)modules/identity-access/(sessions|authorization)/.+/(domain|infrastructure|presentation)(/|$)',
        ],
      },
    },
    {
      name: 'application-must-not-import-generated-prisma',
      severity: 'error',
      from: { path: '(^|/)application(/|$)' },
      to: { path: '(^|/)generated/prisma(/|$)' },
    },
    {
      name: 'platform-non-database-must-not-import-database-drivers',
      severity: 'error',
      from: {
        path: '(^|/)platform/(?!database(/|$)|outbox/prisma-outbox\\.store\\.ts$)',
      },
      to: {
        path: '(^|/)(node_modules/)?(@prisma/|pg(/|$))|(^|/)generated/prisma(/|$)',
      },
    },
    {
      name: 'shared-application-must-not-import-platform-database',
      severity: 'error',
      from: { path: '(^|/)shared/application(/|$)' },
      to: { path: '(^|/)platform/database(/|$)' },
    },
    {
      name: 'no-unresolvable-imports',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: { pathNot: '(^|/)generated/prisma(/|$)' },
      to: { circular: true },
    },
    {
      name: 'domain-must-not-import-frameworks',
      severity: 'error',
      from: { path: '(^|/)domain(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?(@nestjs/|@prisma/|@opentelemetry/|bullmq(/|$)|express(/|$)|ioredis(/|$)|pino(/|$)|redis(/|$))',
      },
    },
    {
      name: 'domain-must-not-import-outer-layers',
      severity: 'error',
      from: { path: '(^|/)domain(/|$)' },
      to: {
        path: '(^|/)(application|infrastructure|presentation|composition|platform|bootstrap)(/|$)',
      },
    },
    {
      name: 'application-must-not-import-non-di-frameworks',
      severity: 'error',
      from: { path: '(^|/)application(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?(@nestjs/(?!common(/|$))|@prisma/|@opentelemetry/|bullmq(/|$)|express(/|$)|ioredis(/|$)|pino(/|$)|redis(/|$))',
      },
    },
    {
      name: 'shared-application-must-not-import-nest',
      severity: 'error',
      from: { path: '(^|/)shared/application(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?@nestjs/',
      },
    },
    {
      name: 'application-must-not-import-adapters',
      severity: 'error',
      from: { path: '(^|/)application(/|$)' },
      to: {
        path: '(^|/)(infrastructure|presentation|composition|platform|bootstrap)(/|$)',
      },
    },
    {
      name: 'presentation-must-not-import-infrastructure',
      severity: 'error',
      from: { path: '(^|/)presentation(/|$)' },
      to: {
        path: '(^|/)infrastructure(/|$)|(^|/)(node_modules/)?(@nestjs/bullmq(/|$)|@prisma/|bullmq(/|$)|ioredis(/|$)|redis(/|$))',
      },
    },
    {
      name: 'presentation-must-not-import-composition',
      severity: 'error',
      from: { path: '(^|/)presentation(/|$)' },
      to: { path: '(^|/)composition(/|$)' },
    },
    {
      name: 'infrastructure-must-not-import-presentation',
      severity: 'error',
      from: { path: '(^|/)infrastructure(/|$)' },
      to: { path: '(^|/)presentation(/|$)' },
    },
    {
      name: 'infrastructure-must-not-import-composition',
      severity: 'error',
      from: { path: '(^|/)infrastructure(/|$)' },
      to: { path: '(^|/)composition(/|$)' },
    },
    {
      name: 'modules-must-not-import-bootstrap',
      severity: 'error',
      from: { path: '(^|/)modules(/|$)' },
      to: { path: '(^|/)bootstrap(/|$)' },
    },
    {
      name: 'platform-must-not-import-modules',
      severity: 'error',
      from: { path: '(^|/)platform(/|$)' },
      to: { path: '(^|/)modules(/|$)' },
    },
    {
      name: 'shared-must-not-import-modules-or-platform',
      severity: 'error',
      from: { path: '(^|/)shared(/|$)' },
      to: { path: '(^|/)(modules|platform|bootstrap)(/|$)' },
    },
    {
      name: 'src-must-not-import-test-scripts-or-templates',
      severity: 'error',
      from: { path: '(^|/)src(/|$)' },
      to: { path: '(^|/)(test|scripts|templates)(/|$)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    enhancedResolveOptions: {
      conditionNames: ['node', 'require', 'types', 'default'],
      exportsFields: ['exports'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
}
