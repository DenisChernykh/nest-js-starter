import { Module } from '@nestjs/common'

import { ApplicationLifecycleState } from './application-lifecycle.state'
import { ShutdownRegistry } from './shutdown-registry'
import { StartupRegistry } from './startup-registry'

/** Provides the process-wide one-way lifecycle state. */
@Module({
  providers: [ApplicationLifecycleState, ShutdownRegistry, StartupRegistry],
  exports: [ApplicationLifecycleState, ShutdownRegistry, StartupRegistry],
})
export class LifecycleModule {}
