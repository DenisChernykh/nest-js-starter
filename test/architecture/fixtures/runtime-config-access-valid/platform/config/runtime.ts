import type { ConfigService } from '@nestjs/config'

export type RawConfig = ConfigService
export const databaseUrl = process.env.DATABASE_URL
