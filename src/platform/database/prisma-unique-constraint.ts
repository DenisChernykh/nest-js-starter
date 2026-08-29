import { Prisma } from '@/generated/prisma/client'

export interface PrismaUniqueConstraintPolicy {
  readonly constraintNames: readonly string[]
  readonly singleFieldNames: readonly string[]
}

export function matchesPrismaUniqueConstraint(
  error: unknown,
  policy: PrismaUniqueConstraintPolicy,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return false

  const targets = uniqueConstraintTargets(error.meta)
  return (
    targets.length > 0 &&
    targets.every((target) => matchesTarget(target, policy))
  )
}

function matchesTarget(
  target: unknown,
  policy: PrismaUniqueConstraintPolicy,
): boolean {
  if (typeof target === 'string') return policy.constraintNames.includes(target)
  return (
    Array.isArray(target) &&
    target.length === 1 &&
    typeof target[0] === 'string' &&
    policy.singleFieldNames.includes(target[0])
  )
}

function uniqueConstraintTargets(
  meta: Record<string, unknown> | undefined,
): readonly unknown[] {
  if (meta === undefined) return []
  const targets: unknown[] = []
  if (Object.hasOwn(meta, 'target')) targets.push(meta.target)

  if (!Object.hasOwn(meta, 'driverAdapterError')) return targets

  const driverAdapterError = asRecord(meta.driverAdapterError)
  const cause = asRecord(driverAdapterError?.cause)
  if (cause?.kind !== 'UniqueConstraintViolation') return []

  const constraint = asRecord(cause.constraint)
  if (constraint === undefined) return []
  const hasFields = Object.hasOwn(constraint, 'fields')
  const hasIndex = Object.hasOwn(constraint, 'index')
  if (hasFields === hasIndex) return []
  targets.push(hasFields ? constraint.fields : constraint.index)
  return targets
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}
