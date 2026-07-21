import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { ProblemExceptionFilter } from './problem-exception.filter'

/** Registers the sole process-wide RFC 9457 exception filter. */
@Module({
  providers: [
    ProblemExceptionFilter,
    { provide: APP_FILTER, useExisting: ProblemExceptionFilter },
  ],
  exports: [ProblemExceptionFilter],
})
export class HttpErrorsModule {}
