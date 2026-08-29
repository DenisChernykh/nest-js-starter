// Intentional identity-access leak from a public contract into application internals.
import { internalAuthValue } from '../application/internal'

export const publicAuthValue = internalAuthValue
