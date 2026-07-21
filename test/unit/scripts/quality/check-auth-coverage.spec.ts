import {
  assertCoverageGroups,
  type CoverageSummary,
} from '@scripts/quality/check-auth-coverage'

function file(branches: { covered: number; total: number }): CoverageSummary {
  return {
    branches: {
      ...branches,
      pct:
        branches.total === 0 ? 100 : (branches.covered / branches.total) * 100,
      skipped: 0,
    },
  }
}

describe('auth coverage gate', () => {
  it('aggregates branch counts across every file in a collected path', () => {
    const summary = {
      '/repo/src/modules/auth/application/login.use-case.ts': file({
        covered: 8,
        total: 10,
      }),
      '/repo/src/modules/auth/application/logout.use-case.ts': file({
        covered: 10,
        total: 10,
      }),
      '/repo/src/modules/auth/infrastructure/redis-session.store.ts': file({
        covered: 9,
        total: 10,
      }),
      '/repo/src/modules/auth/presentation/session-csrf.guard.ts': file({
        covered: 9,
        total: 10,
      }),
    }

    expect(() => assertCoverageGroups(summary, '/repo')).not.toThrow()
  })

  it('reports the group and exact percentage below the required threshold', () => {
    const summary = {
      '/repo/src/modules/auth/application/login.use-case.ts': file({
        covered: 8,
        total: 10,
      }),
      '/repo/src/modules/auth/infrastructure/redis-session.store.ts': file({
        covered: 9,
        total: 10,
      }),
      '/repo/src/modules/auth/presentation/authentication.guard.ts': file({
        covered: 9,
        total: 10,
      }),
    }

    expect(() => assertCoverageGroups(summary, '/repo')).toThrow(
      'auth application branch coverage is 80.00% (8/10), expected at least 90%',
    )
  })

  it('fails when a required collected path contains no executable branches', () => {
    expect(() => assertCoverageGroups({}, '/repo')).toThrow(
      'auth application coverage group has no executable branches',
    )
  })
})
