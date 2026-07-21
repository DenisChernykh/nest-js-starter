import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'

import { POSTGRES_IMAGE } from './postgres-image'

export async function startPostgresContainer(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('nest_js_starter_test')
    .withUsername('nest_js_starter')
    .withPassword('nest_js_starter')
    .start()
}
