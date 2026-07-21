import type { ValidationError } from 'class-validator'

import { RequestValidationError } from '@/platform/http/errors/request-validation.error'
import { mapValidationErrors } from '@/platform/http/errors/validation-error.mapper'

function validationError(value: Partial<ValidationError>): ValidationError {
  return value as ValidationError
}

describe('mapValidationErrors', () => {
  it('flattens nested objects and arrays with escaped RFC 6901 pointers', () => {
    const errors = [
      validationError({
        property: 'profile',
        children: [
          validationError({
            property: 'a/b~c',
            constraints: {
              isString: 'raw secret value must be a string',
              minLength: 'raw secret value is too short',
            },
          }),
        ],
      }),
      validationError({
        property: 'items',
        children: [
          validationError({
            property: '0',
            constraints: { isEmail: 'private@example.test is not an email' },
          }),
        ],
      }),
    ]

    expect(mapValidationErrors(errors)).toEqual([
      {
        pointer: '/items/0',
        code: 'invalid_format',
        detail: 'Field has an invalid format.',
      },
      {
        pointer: '/profile/a~1b~0c',
        code: 'invalid_type',
        detail: 'Field has an invalid type.',
      },
      {
        pointer: '/profile/a~1b~0c',
        code: 'too_short',
        detail: 'Field is shorter than allowed.',
      },
    ])
  })

  it('maps reviewed constraints, sorts output and deduplicates client issues', () => {
    const errors = [
      validationError({
        property: 'z',
        constraints: {
          matches: 'contains raw pattern and value',
          isEmail: 'contains a raw email',
          futureConstraint: 'contains a future secret',
        },
      }),
      validationError({
        property: 'a',
        constraints: {
          maxLength: 'raw value',
          minLength: 'raw value',
          whitelistValidation: 'raw unknown field value',
        },
      }),
    ]

    expect(mapValidationErrors(errors)).toEqual([
      {
        pointer: '/a',
        code: 'too_long',
        detail: 'Field is longer than allowed.',
      },
      {
        pointer: '/a',
        code: 'too_short',
        detail: 'Field is shorter than allowed.',
      },
      {
        pointer: '/a',
        code: 'unknown_field',
        detail: 'Field is not allowed.',
      },
      {
        pointer: '/z',
        code: 'invalid_format',
        detail: 'Field has an invalid format.',
      },
      {
        pointer: '/z',
        code: 'invalid_value',
        detail: 'Field has an invalid value.',
      },
    ])
  })

  it('returns deeply frozen field errors without rejected values', () => {
    const mapped = mapValidationErrors([
      validationError({
        property: 'password',
        value: 'top-secret',
        target: { password: 'top-secret' },
        constraints: { isDefined: 'top-secret should not be null' },
      }),
    ])
    const error = new RequestValidationError(mapped)

    expect(error.message).toBe('Request validation failed')
    expect(error.errors).toEqual([
      {
        pointer: '/password',
        code: 'required',
        detail: 'Required field is missing.',
      },
    ])
    expect(JSON.stringify(error.errors)).not.toContain('top-secret')
    expect(Object.isFrozen(error.errors)).toBe(true)
    expect(Object.isFrozen(error.errors[0])).toBe(true)
  })
})
