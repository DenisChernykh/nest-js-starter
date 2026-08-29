// Allowed Authorization to Sessions edge.
import { sessionContract } from '../../sessions/application/session'

export const authorizationContract = `authorization:${sessionContract}`
