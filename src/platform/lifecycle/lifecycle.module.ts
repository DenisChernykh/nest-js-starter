import { Module } from '@nestjs/common'

import { ApplicationLifecycleState } from './application-lifecycle.state'
import { ShutdownRegistry } from './shutdown-registry'

/** Provides the process-wide one-way lifecycle state. */
@Module({
  providers: [ApplicationLifecycleState, ShutdownRegistry],
  exports: [ApplicationLifecycleState, ShutdownRegistry],
})
export class LifecycleModule {}
