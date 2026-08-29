// Intentional reverse DAG edge.
import { authenticationContract } from '../../authentication/password/application/authenticate'

export const authorizationContract = `authorization:${authenticationContract}`
