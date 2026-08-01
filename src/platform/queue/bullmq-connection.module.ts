import { BullModule } from '@nestjs/bullmq'
import { Module, type DynamicModule } from '@nestjs/common'

import {
  createBullmqProducerOptions,
  createBullmqWorkerOptions,
} from './bullmq-redis-options'
import type { QueueRuntimeConfig } from './queue-runtime-config'

/** Reusable BullMQ root connection composition without queue registration. */
@Module({})
export class BullmqConnectionModule {
  /**
   * Composes one producer-oriented BullMQ root connection.
   *
   * @param config - Validated queue URL and queue deadlines.
   * @returns Dynamic module containing exactly one BullMQ root module.
   */
  public static forProducer(config: QueueRuntimeConfig): DynamicModule {
    return {
      module: BullmqConnectionModule,
      imports: [
        BullModule.forRoot({
          connection: createBullmqProducerOptions(config),
        }),
      ],
    }
  }

  /**
   * Composes one blocking-worker BullMQ root connection.
   *
   * @param config - Validated queue URL and queue deadlines.
   * @returns Dynamic module containing exactly one BullMQ root module.
   */
  public static forWorker(config: QueueRuntimeConfig): DynamicModule {
    return {
      module: BullmqConnectionModule,
      imports: [
        BullModule.forRoot({
          connection: createBullmqWorkerOptions(config),
        }),
      ],
    }
  }
}
