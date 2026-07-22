import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  assertExactStableDirectDependencies,
  assertNoSwaggerTransformerConfig,
  assertObservabilityDependencyFamily,
  assertTypeScriptBridge,
  type TypeScriptBridgeEvidence,
  type TypeScriptBridgeManifest,
} from '@scripts/toolchain/check-typescript-bridge'

const OBSERVABILITY_DEPENDENCY_FAMILY = {
  '@opentelemetry/api': '1.9.1',
  '@opentelemetry/exporter-metrics-otlp-http': '0.220.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.220.0',
  '@opentelemetry/instrumentation-http': '0.220.0',
  '@opentelemetry/instrumentation-pg': '0.72.0',
  '@opentelemetry/instrumentation-redis': '0.68.0',
  '@opentelemetry/resources': '2.9.0',
  '@opentelemetry/sdk-metrics': '2.9.0',
  '@opentelemetry/sdk-node': '0.220.0',
  '@opentelemetry/sdk-trace-base': '2.9.0',
  '@opentelemetry/semantic-conventions': '1.43.0',
  pino: '10.3.1',
} as const

const OPENAPI_RUNTIME_DEPENDENCY_FAMILY = {
  '@nestjs/swagger': '11.4.6',
} as const

const OPENAPI_DEVELOPMENT_DEPENDENCY_FAMILY = {
  '@hey-api/openapi-ts': '0.99.0',
  '@redocly/cli': '2.40.0',
  'openapi-diff': '0.24.1',
  'openapi-response-validator': '12.1.3',
} as const

describe('TypeScript toolchain bridge', () => {
  const packageManifest = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as TypeScriptBridgeManifest
  const nativeAlias = 'npm:typescript@7.0.2'
  const compatibilityAlias = 'npm:@typescript/typescript6@6.0.2'
  const manifest: TypeScriptBridgeManifest = {
    devDependencies: {
      '@typescript/native': nativeAlias,
      typescript: compatibilityAlias,
    },
  }
  const evidence: TypeScriptBridgeEvidence = {
    compatibilityApiVersion: '6.0.3',
    compatibilityCliVersion: '6.0.3',
    nativeCliVersion: '7.0.2',
  }

  it('accepts the exact native compiler and one matching compatibility API', () => {
    expect(() => assertTypeScriptBridge(manifest, evidence)).not.toThrow()
  })

  it.each([
    [
      'missing native alias',
      { devDependencies: { typescript: compatibilityAlias } },
    ],
    [
      'swapped aliases',
      {
        devDependencies: {
          '@typescript/native': compatibilityAlias,
          typescript: nativeAlias,
        },
      },
    ],
  ])('rejects a %s', (_name, invalidManifest) => {
    expect(() => assertTypeScriptBridge(invalidManifest, evidence)).toThrow(
      'Invalid TypeScript toolchain bridge',
    )
  })

  it('rejects a mismatched compatibility CLI and imported API', () => {
    expect(() =>
      assertTypeScriptBridge(manifest, {
        ...evidence,
        compatibilityApiVersion: '6.0.2',
      }),
    ).toThrow('Invalid TypeScript toolchain bridge')
  })

  it('rejects ranged and prerelease direct dependency specs', () => {
    expect(() =>
      assertExactStableDirectDependencies({
        dependencies: { exact: '1.2.3', ranged: '^1.2.3' },
        devDependencies: { preview: '2.0.0-rc.1' },
      }),
    ).toThrow('Direct dependencies must use exact stable versions')
  })

  it('keeps every committed direct dependency exact and stable', () => {
    expect(() =>
      assertExactStableDirectDependencies(packageManifest),
    ).not.toThrow()
  })

  it('keeps the committed observability dependency family exact and coherent', () => {
    expect(() =>
      assertObservabilityDependencyFamily(
        packageManifest,
        OBSERVABILITY_DEPENDENCY_FAMILY,
      ),
    ).not.toThrow()
  })

  it('keeps the committed OpenAPI dependency family exact and compiler-compatible', () => {
    expect(packageManifest.dependencies).toEqual(
      expect.objectContaining(OPENAPI_RUNTIME_DEPENDENCY_FAMILY),
    )
    expect(packageManifest.devDependencies).toEqual(
      expect.objectContaining(OPENAPI_DEVELOPMENT_DEPENDENCY_FAMILY),
    )
    expect(packageManifest.dependencies).not.toHaveProperty(
      'swagger-ui-express',
    )
    expect(packageManifest.devDependencies).not.toHaveProperty(
      'openapi-typescript',
    )
    expect(packageManifest.devDependencies).not.toHaveProperty(
      '@hey-api/client-fetch',
    )
  })

  it('rejects Nest Swagger compiler plugins and custom transformers', () => {
    expect(() =>
      assertNoSwaggerTransformerConfig([
        { compilerOptions: { plugins: ['@nestjs/swagger'] } },
      ]),
    ).toThrow('Swagger transformer configuration is forbidden')
    expect(() =>
      assertNoSwaggerTransformerConfig([
        {
          compilerOptions: {
            plugins: [{ transform: '@nestjs/swagger/plugin' }],
          },
        },
      ]),
    ).toThrow('Swagger transformer configuration is forbidden')
    expect(() =>
      assertNoSwaggerTransformerConfig([
        { compilerOptions: { plugins: [{ name: 'unrelated' }] } },
      ]),
    ).not.toThrow()
  })

  it.each([
    ['a ranged Pino version', { pino: '^10.3.1' }],
    [
      'a mismatched experimental exporter',
      { '@opentelemetry/exporter-trace-otlp-http': '0.219.0' },
    ],
    [
      'a mismatched stable SDK package',
      { '@opentelemetry/sdk-metrics': '2.8.0' },
    ],
    ['an incompatible API package', { '@opentelemetry/api': '1.8.0' }],
  ])('rejects %s', (_name, replacement) => {
    expect(() =>
      assertObservabilityDependencyFamily(
        {
          dependencies: {
            ...OBSERVABILITY_DEPENDENCY_FAMILY,
            ...replacement,
          },
        },
        OBSERVABILITY_DEPENDENCY_FAMILY,
      ),
    ).toThrow('Invalid observability dependency family')
  })

  it.each([
    'nestjs-pino',
    'pino-http',
    'pino-pretty',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/instrumentation-express',
  ])('rejects forbidden direct package %s', (forbiddenPackage) => {
    expect(() =>
      assertObservabilityDependencyFamily(
        {
          dependencies: {
            ...OBSERVABILITY_DEPENDENCY_FAMILY,
            [forbiddenPackage]: '1.2.3',
          },
        },
        OBSERVABILITY_DEPENDENCY_FAMILY,
      ),
    ).toThrow('Invalid observability dependency family')
  })
})
