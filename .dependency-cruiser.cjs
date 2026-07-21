/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-unresolvable-imports',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-must-not-import-frameworks',
      severity: 'error',
      from: { path: '(^|/)domain(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?(@nestjs/|@prisma/|@opentelemetry/|express(/|$)|ioredis(/|$)|pino(/|$)|redis(/|$))',
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
      name: 'application-must-not-import-frameworks',
      severity: 'error',
      from: { path: '(^|/)application(/|$)' },
      to: {
        path: '(^|/)(node_modules/)?(@nestjs/|@prisma/|@opentelemetry/|express(/|$)|ioredis(/|$)|pino(/|$)|redis(/|$))',
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
        path: '(^|/)infrastructure(/|$)|(^|/)(node_modules/)?(@prisma/|ioredis(/|$)|redis(/|$))',
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
