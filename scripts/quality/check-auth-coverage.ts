import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Covered and total counters emitted for one Istanbul metric. */
export interface CoverageMetric {
  readonly covered: number
  readonly total: number
  readonly skipped: number
  readonly pct: number
}

/** Minimal per-file shape consumed from Istanbul coverage-summary.json. */
export interface CoverageSummary {
  readonly branches: CoverageMetric
}

/** Istanbul summary indexed by absolute source path, plus its optional total. */
export type CoverageSummaryFile = Readonly<Record<string, CoverageSummary>>

/** Aggregate branch evidence for one required auth coverage group. */
export interface CoverageGroupResult {
  readonly name: string
  readonly covered: number
  readonly total: number
  readonly percentage: number
}

interface CoverageGroup {
  readonly name: string
  readonly matches: (relativePath: string) => boolean
}

const REQUIRED_BRANCH_PERCENTAGE = 90
const GROUPS: readonly CoverageGroup[] = [
  {
    name: 'auth application',
    matches: (path) => path.startsWith('src/modules/auth/application/'),
  },
  {
    name: 'auth session infrastructure',
    matches: (path) =>
      /^src\/modules\/auth\/infrastructure\/[^/]*session[^/]*\.ts$/u.test(path),
  },
  {
    name: 'auth presentation guards',
    matches: (path) =>
      /^src\/modules\/auth\/presentation\/[^/]*guard[^/]*\.ts$/u.test(path),
  },
]

function portableRelativePath(
  projectRoot: string,
  absolutePath: string,
): string {
  return relative(projectRoot, absolutePath).split(sep).join('/')
}

/**
 * Enforces aggregate auth branch thresholds over the reviewed collected paths.
 *
 * @param summaryFile - Istanbul per-file coverage summary.
 * @param projectRoot - Absolute repository root used to normalize source paths.
 * @returns Exact aggregate counters for every required auth group.
 * @throws Error when a required group is empty or below 90 percent branches.
 */
export function assertCoverageGroups(
  summaryFile: CoverageSummaryFile,
  projectRoot: string,
): readonly CoverageGroupResult[] {
  const entries = Object.entries(summaryFile).filter(
    ([path]) => path !== 'total',
  )
  const results: CoverageGroupResult[] = []

  for (const group of GROUPS) {
    const metric = entries.reduce(
      (result, [path, summary]) => {
        if (!group.matches(portableRelativePath(projectRoot, path)))
          return result
        return {
          covered: result.covered + summary.branches.covered,
          total: result.total + summary.branches.total,
        }
      },
      { covered: 0, total: 0 },
    )
    if (metric.total === 0) {
      throw new Error(`${group.name} coverage group has no executable branches`)
    }
    const percentage = (metric.covered / metric.total) * 100
    if (percentage < REQUIRED_BRANCH_PERCENTAGE) {
      throw new Error(
        `${group.name} branch coverage is ${percentage.toFixed(2)}% (${metric.covered}/${metric.total}), expected at least ${REQUIRED_BRANCH_PERCENTAGE}%`,
      )
    }
    results.push({
      name: group.name,
      covered: metric.covered,
      total: metric.total,
      percentage,
    })
  }
  return Object.freeze(results)
}

function main(): void {
  const projectRoot = process.cwd()
  const path = join(projectRoot, 'coverage/runtime/coverage-summary.json')
  const summary = JSON.parse(readFileSync(path, 'utf8')) as CoverageSummaryFile
  for (const result of assertCoverageGroups(summary, projectRoot)) {
    process.stdout.write(
      `${result.name} branches: ${result.percentage.toFixed(2)}% (${result.covered}/${result.total})\n`,
    )
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
