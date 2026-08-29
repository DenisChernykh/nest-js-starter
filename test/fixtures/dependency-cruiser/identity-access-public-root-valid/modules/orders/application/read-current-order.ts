// External consumer uses only the root entrypoint.
import { authenticatedPrincipal } from '../../identity-access'

export const currentOrderOwner = authenticatedPrincipal.subjectId
