import type { ValidationErrorItem } from 'joi'

import {
  RuntimeConfigurationError,
  type RuntimeConfigurationIssue,
  type ValidatedRuntimeEnvironment,
} from './runtime-config.types'
import { runtimeEnvironmentSchema } from './runtime-environment.schema'

function toIssue(detail: ValidationErrorItem): RuntimeConfigurationIssue {
  return {
    path: detail.path.length === 0 ? 'runtime' : detail.path.join('.'),
    rule: detail.type,
  }
}

/**
 * Validates and normalizes the process environment before runtime startup.
 *
 * @param input - Untrusted environment key/value record.
 * @returns Typed normalized values for the keys owned by this runtime slice.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function validateRuntimeEnvironment(
  input: Record<string, unknown>,
): ValidatedRuntimeEnvironment {
  const result = runtimeEnvironmentSchema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  })
  if (result.error !== undefined) {
    throw new RuntimeConfigurationError(result.error.details.map(toIssue))
  }
  return result.value
}
