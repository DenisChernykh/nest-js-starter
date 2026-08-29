import { Prisma } from '@/generated/prisma/client'

const normalizedEmailFieldTargets = new Set([
  'normalizedEmail',
  'normalized_email',
])
const normalizedEmailConstraint = 'users_normalized_email_key'

export function isNormalizedEmailUniqueConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return false

  const targets = uniqueConstraintTargets(error.meta)
  return targets.length > 0 && targets.every(isNormalizedEmailTarget)
}

function isNormalizedEmailTarget(target: unknown): boolean {
  if (typeof target === 'string') return target === normalizedEmailConstraint
  return (
    Array.isArray(target) &&
    target.length === 1 &&
    typeof target[0] === 'string' &&
    normalizedEmailFieldTargets.has(target[0])
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
