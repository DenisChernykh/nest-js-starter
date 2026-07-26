import { Module } from '@nestjs/common'

import { ApplicationLifecycleState } from './application-lifecycle.state'

/** Provides the process-wide one-way lifecycle state. */
@Module({
  providers: [ApplicationLifecycleState],
  exports: [ApplicationLifecycleState],
})
export class LifecycleModule {}
