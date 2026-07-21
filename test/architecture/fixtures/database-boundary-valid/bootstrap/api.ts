import type { DatabaseModule } from '@/platform/database/database.module'
import { DATABASE_LIFECYCLE } from '@/platform/database/database.tokens'

export type RootDatabaseModule = DatabaseModule
export const lifecycleToken = DATABASE_LIFECYCLE
