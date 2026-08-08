import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module, type DynamicModule } from '@nestjs/common'

import {
  BullMqOutboxPublisher,
  type BullMqQueuePort,
} from './bullmq-outbox.publisher'
import { OutboxRelay } from './outbox-relay'
import { OutboxRelayRunner } from './outbox-relay-runner'
import { OutboxRetentionCleanup } from './outbox-retention-cleanup'
import {
  OUTBOX_PUBLISHER,
  OUTBOX_STORE,
  type OutboxStorePort,
} from './outbox.ports'
import { OutboxModule } from './outbox.module'

export interface BullMqOutboxRelayOptions {
  readonly destination: string
  readonly queueName: string
  readonly ownerId?: string
}

const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS')
export const OUTBOX_RELAY = Symbol('OUTBOX_RELAY')
export const OUTBOX_RELAY_RUNNER = Symbol('OUTBOX_RELAY_RUNNER')
export const OUTBOX_RETENTION_CLEANUP = Symbol('OUTBOX_RETENTION_CLEANUP')

@Module({})
export class OutboxRelayModule {
  public static forBullMq(options: BullMqOutboxRelayOptions): DynamicModule {
    return {
      module: OutboxRelayModule,
      imports: [
        OutboxModule.forWriter(),
        BullModule.registerQueue({ name: options.queueName }),
      ],
      providers: [
        {
          provide: OUTBOX_RELAY_OPTIONS,
          useValue: Object.freeze({ ...options }),
        },
        {
          provide: BullMqOutboxPublisher,
          inject: [getQueueToken(options.queueName)],
          useFactory: (queue: BullMqQueuePort): BullMqOutboxPublisher =>
            new BullMqOutboxPublisher(queue),
        },
        { provide: OUTBOX_PUBLISHER, useExisting: BullMqOutboxPublisher },
        {
          provide: OUTBOX_RELAY,
          inject: [OUTBOX_STORE, OUTBOX_PUBLISHER, OUTBOX_RELAY_OPTIONS],
          useFactory: (
            store: OutboxStorePort,
            publisher: BullMqOutboxPublisher,
            relayOptions: BullMqOutboxRelayOptions,
          ): OutboxRelay =>
            new OutboxRelay(store, publisher, {
              destination: relayOptions.destination,
              ownerId: relayOptions.ownerId ?? relayOptions.queueName,
            }),
        },
        {
          provide: OUTBOX_RELAY_RUNNER,
          inject: [OUTBOX_RELAY],
          useFactory: (relay: OutboxRelay): OutboxRelayRunner =>
            new OutboxRelayRunner(relay),
        },
        {
          provide: OUTBOX_RETENTION_CLEANUP,
          inject: [OUTBOX_STORE],
          useFactory: (store: OutboxStorePort): OutboxRetentionCleanup =>
            new OutboxRetentionCleanup(store),
        },
      ],
      exports: [OUTBOX_RELAY, OUTBOX_RELAY_RUNNER, OUTBOX_RETENTION_CLEANUP],
    }
  }
}
