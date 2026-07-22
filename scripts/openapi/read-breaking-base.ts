import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Explicit local source for the comparison contract. */
export type BreakingBaseSource =
  | { readonly kind: 'file'; readonly value: string }
  | { readonly kind: 'ref'; readonly value: string }

/**
 * Resolves exactly one CLI or environment base source without defaults.
 *
 * @param arguments_ - CLI arguments after the script path.
 * @param environment - Environment variables visible to the caller.
 * @returns One explicit file or Git ref source.
 */
export function resolveBreakingBaseSource(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BreakingBaseSource {
  const normalizedArguments =
    arguments_[0] === '--' ? arguments_.slice(1) : arguments_
  const sources: BreakingBaseSource[] = []
  if (normalizedArguments.length > 0) {
    const [flag, value] = normalizedArguments
    if (
      normalizedArguments.length === 2 &&
      value !== undefined &&
      value.trim() !== '' &&
      (flag === '--base-file' || flag === '--base-ref')
    ) {
      sources.push({
        kind: flag === '--base-file' ? 'file' : 'ref',
        value,
      })
    } else {
      sources.push({ kind: 'file', value: '' })
    }
  }
  const environmentFile = environment['OPENAPI_BREAKING_BASE_FILE']
  const environmentRef = environment['OPENAPI_BREAKING_BASE_REF']
  if (environmentFile?.trim()) {
    sources.push({ kind: 'file', value: environmentFile })
  }
  if (environmentRef?.trim()) {
    sources.push({ kind: 'ref', value: environmentRef })
  }
  const source = sources[0]
  if (sources.length !== 1 || source === undefined || source.value === '') {
    throw new Error('Exactly one OpenAPI breaking base source is required')
  }
  return source
}

/**
 * Reads base bytes from one file or an exact Git object path.
 *
 * @param source - Explicit base source selected by the caller.
 * @returns UTF-8 OpenAPI artifact bytes as text.
 */
export async function readBreakingBase(
  source: BreakingBaseSource,
): Promise<string> {
  if (source.kind === 'file') {
    try {
      return await readFile(resolve(source.value), 'utf8')
    } catch {
      throw new Error('OpenAPI breaking base file is unavailable')
    }
  }

  const result = spawnSync(
    'git',
    ['show', `${source.value}:docs/api/openapi.json`],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  if (result.status !== 0 || result.stdout === '') {
    throw new Error('OpenAPI breaking base Git artifact is unavailable')
  }
  return result.stdout
}
