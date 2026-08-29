// Allowed lifecycle orchestration edges.
import { authenticationContract } from '../../../authentication/password/application/authenticate'
import { authorizationContract } from '../../../authorization/application/authorization'
import { sessionContract } from '../../../sessions/application/session'

export const lifecycleContract = [
  authenticationContract,
  authorizationContract,
  sessionContract,
].join(':')
