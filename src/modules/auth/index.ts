/**
 * @packageDocumentation
 * Framework-free auth application contracts plus the narrow Nest controller
 * integration for the current principal and permission requirements.
 */
export * from '@/modules/auth/application'
export { CurrentPrincipal } from './presentation/current-principal.decorator'
export { RequirePermission } from './presentation/require-permission.decorator'
