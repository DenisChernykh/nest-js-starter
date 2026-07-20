import type { Repository } from '../infrastructure/repository'
export type UseCase = (repository: Repository) => void
