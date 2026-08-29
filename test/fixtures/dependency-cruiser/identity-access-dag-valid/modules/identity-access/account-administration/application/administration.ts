// Allowed administration orchestration edges.
import { authorizationContract } from '../../authorization/application/authorization'
import { sessionContract } from '../../sessions/application/session'

export const administrationContract = `${authorizationContract}:${sessionContract}`
