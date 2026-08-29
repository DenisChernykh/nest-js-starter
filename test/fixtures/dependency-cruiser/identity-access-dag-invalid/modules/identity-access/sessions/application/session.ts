// Intentional reverse DAG edge.
import { authorizationContract } from '../../authorization/application/authorization'

export const sessionContract = `session:${authorizationContract}`
