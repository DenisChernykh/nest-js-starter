import { Module, type DynamicModule } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import type { HttpProblemContribution } from './problem.contracts'
import { HttpProblemRegistry } from './http-problem.registry'
import { ProblemExceptionFilter } from './problem-exception.filter'

/** Configures the sole process-wide RFC 9457 exception filter. */
@Module({})
export class HttpErrorsModule {
  /**
   * Registers one immutable problem registry at the process composition root.
   *
   * @param contributions - Ordered module mappings selected by the root.
   * @returns Dynamic module owning the sole global exception filter.
   */
  public static forRoot(
    contributions: readonly HttpProblemContribution[],
  ): DynamicModule {
    const registry = Object.freeze(new HttpProblemRegistry(contributions))
    return {
      module: HttpErrorsModule,
      providers: [
        { provide: HttpProblemRegistry, useValue: registry },
        ProblemExceptionFilter,
        { provide: APP_FILTER, useExisting: ProblemExceptionFilter },
      ],
      exports: [HttpProblemRegistry, ProblemExceptionFilter],
    }
  }
}
