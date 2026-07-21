import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  assertExactStableDirectDependencies,
  assertTypeScriptBridge,
  type TypeScriptBridgeEvidence,
  type TypeScriptBridgeManifest,
} from '@scripts/toolchain/check-typescript-bridge'

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
})
