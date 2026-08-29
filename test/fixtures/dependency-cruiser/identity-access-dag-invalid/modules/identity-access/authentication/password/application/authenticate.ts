// Intentional reverse DAG edge.
import { identityContract } from '../../../identity/application/identity'

export const authenticationContract = `authentication:${identityContract}`
