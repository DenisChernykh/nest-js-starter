// Intentional transitive leak through a nominally public contract.
import { sessionContract } from '../sessions/application/session'

export const leakedSessionContract = sessionContract
