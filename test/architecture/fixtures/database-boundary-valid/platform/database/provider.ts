import type { PrismaPg } from '@prisma/adapter-pg'
import type { Pool } from 'pg'

import type { PrismaClient } from '@/generated/prisma/client'

export type DatabaseDependencies = PrismaClient | PrismaPg | Pool
