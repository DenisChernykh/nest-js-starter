import { randomUUID } from 'node:crypto'

import { Module, type DynamicModule } from '@nestjs/common'

import type { OutboxRelayRuntimeConfig } from '@/platform/config/runtime-config.types'
import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'

import {
  type BullMqOutboxQueueOptions,
  OutboxRelayModule,
} from './outbox-relay.module'

export interface OutboxRelayRuntimeModuleOptions {
  readonly config: OutboxRelayRuntimeConfig
  readonly destination: string
  readonly queueName: string
  readonly ownerId?: string
  readonly queueOptions?: BullMqOutboxQueueOptions
}

@Module({})
export class OutboxRelayRuntimeModule {
  public static forBullMq(
    options: OutboxRelayRuntimeModuleOptions,
  ): DynamicModule {
    return {
      module: OutboxRelayRuntimeModule,
      imports: [
        BullmqConnectionModule.forProducer(options.config.queue),
        OutboxRelayModule.forBullMq({
          destination: options.destination,
          queueName: options.queueName,
          ownerId:
            options.ownerId ??
            createProcessOwnerId(
              options.config.logging.serviceName,
              options.config.logging.serviceRevision,
            ),
          ...(options.queueOptions === undefined
            ? {}
            : { queueOptions: options.queueOptions }),
          databaseConfig: options.config.database,
        }),
      ],
      exports: [OutboxRelayModule],
    }
  }
}

function createProcessOwnerId(
  serviceName: string,
  serviceRevision: string,
): string {
  const instanceId = randomUUID()
  const suffix = `:${instanceId}`
  const identity = `${serviceName}:${serviceRevision}`
  return `${identity.slice(0, 160 - suffix.length)}${suffix}`
}
