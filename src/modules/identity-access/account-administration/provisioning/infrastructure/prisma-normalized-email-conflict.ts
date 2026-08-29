import { matchesPrismaUniqueConstraint } from '@/platform/database/prisma-unique-constraint'

export function isNormalizedEmailUniqueConflict(error: unknown): boolean {
  return matchesPrismaUniqueConstraint(error, {
    constraintNames: ['users_normalized_email_key'],
    singleFieldNames: ['normalizedEmail', 'normalized_email'],
  })
}
