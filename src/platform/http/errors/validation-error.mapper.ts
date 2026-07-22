import type { ValidationError } from 'class-validator'

import type { ProblemFieldError } from './problem.contracts'

type FieldErrorCode =
  | 'required'
  | 'unknown_field'
  | 'invalid_type'
  | 'invalid_format'
  | 'invalid_value'
  | 'too_short'
  | 'too_long'
  | 'too_few_items'
  | 'too_many_items'

const constraintCodes: Readonly<Record<string, FieldErrorCode>> = Object.freeze(
  {
    isDefined: 'required',
    isNotEmpty: 'required',
    whitelistValidation: 'unknown_field',
    isString: 'invalid_type',
    isArray: 'invalid_type',
    isObject: 'invalid_type',
    isBoolean: 'invalid_type',
    isNumber: 'invalid_type',
    isInt: 'invalid_type',
    isEmail: 'invalid_format',
    isDateString: 'invalid_format',
    isUUID: 'invalid_format',
    matches: 'invalid_format',
    isEnum: 'invalid_value',
    minLength: 'too_short',
    maxLength: 'too_long',
    arrayMinSize: 'too_few_items',
    arrayMaxSize: 'too_many_items',
  },
)

const details: Readonly<Record<FieldErrorCode, string>> = Object.freeze({
  required: 'Required field is missing.',
  unknown_field: 'Field is not allowed.',
  invalid_type: 'Field has an invalid type.',
  invalid_format: 'Field has an invalid format.',
  invalid_value: 'Field has an invalid value.',
  too_short: 'Field is shorter than allowed.',
  too_long: 'Field is longer than allowed.',
  too_few_items: 'Field has fewer items than allowed.',
  too_many_items: 'Field has more items than allowed.',
})

/**
 * Flattens class-validator failures into deterministic value-free field issues.
 *
 * @param errors - Validation tree produced by Nest ValidationPipe.
 * @returns Deeply frozen, deduplicated issues sorted by pointer and client code.
 */
export function mapValidationErrors(
  errors: readonly ValidationError[],
): readonly ProblemFieldError[] {
  const mapped: ProblemFieldError[] = []
  for (const error of errors) collectError(error, '', mapped)

  const unique = new Map<string, ProblemFieldError>()
  for (const issue of mapped) {
    unique.set(`${issue.pointer}\u0000${issue.code}`, issue)
  }
  return Object.freeze(
    [...unique.values()]
      .sort(
        (left, right) =>
          compareText(left.pointer, right.pointer) ||
          compareText(left.code, right.code),
      )
      .map((issue) => Object.freeze(issue)),
  )
}

function collectError(
  error: ValidationError,
  parentPointer: string,
  output: ProblemFieldError[],
): void {
  const property: unknown = error.property
  const pointer =
    typeof property === 'string' && property.length > 0
      ? `${parentPointer}/${escapePointerSegment(property)}`
      : parentPointer
  for (const constraint of Object.keys(error.constraints ?? {}).sort()) {
    const code = constraintCodes[constraint] ?? 'invalid_value'
    output.push({ pointer, code, detail: details[code] })
  }
  for (const child of error.children ?? []) {
    collectError(child, pointer, output)
  }
}

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
