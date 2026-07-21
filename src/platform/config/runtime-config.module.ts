import { Global, Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigService } from './runtime-config.service'
import {
  APPLICATION_RUNTIME_CONFIG,
  type ApplicationRuntimeConfig,
} from './runtime-config.types'

/** Explicit global Nest boundary for one prevalidated runtime configuration. */
@Global()
@Module({})
export class RuntimeConfigModule {
  /**
   * Binds a complete immutable API config without reading process environment.
   *
   * @param config - Prevalidated configuration built before Nest startup.
   * @returns Dynamic global module exposing only typed config providers.
   */
  public static forRoot(config: ApplicationRuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      providers: [
        { provide: APPLICATION_RUNTIME_CONFIG, useValue: config },
        RuntimeConfigService,
      ],
      exports: [APPLICATION_RUNTIME_CONFIG, RuntimeConfigService],
    }
  }
}
