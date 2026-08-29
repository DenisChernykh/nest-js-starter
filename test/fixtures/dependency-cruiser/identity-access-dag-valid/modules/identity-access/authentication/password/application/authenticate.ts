// Allowed Authentication to Sessions edge.
import { sessionContract } from '../../../sessions/application/session'

export const authenticationContract = `authentication:${sessionContract}`
