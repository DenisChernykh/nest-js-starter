import {
  UnsupportedMediaTypeException,
  type ExecutionContext,
} from '@nestjs/common'

import { AuthCsrfRejectedError } from '@/modules/identity-access/public-contracts/auth-errors'
import { BrowserOriginGuard } from '@/modules/identity-access/authorization/presentation/browser-origin.guard'

function context(
  method: string,
  headers: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext
}

describe('BrowserOriginGuard', () => {
  const guard = new BrowserOriginGuard(['https://app.example.com'])

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe method %s', (method) => {
    expect(guard.canActivate(context(method, {}))).toBe(true)
  })

  it('allows an unsafe JSON request with an exact trusted Origin', () => {
    expect(
      guard.canActivate(
        context('POST', {
          origin: 'https://app.example.com',
          'content-type': 'application/json; charset=utf-8',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true)
  })

  it('uses an exact Referer origin when Origin is absent', () => {
    expect(
      guard.canActivate(
        context('PUT', {
          referer: 'https://app.example.com/settings/security',
          'content-type': 'application/json',
        }),
      ),
    ).toBe(true)
  })

  it.each([
    [
      'cross-site fetch',
      {
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
      },
    ],
    ['missing origin and referer', { 'content-type': 'application/json' }],
    [
      'untrusted origin',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
    ],
  ])('rejects %s', (_name, headers) => {
    expect(() => guard.canActivate(context('POST', headers))).toThrow(
      AuthCsrfRejectedError,
    )
  })

  it('reports a non-JSON unsafe request as unsupported media type', () => {
    expect(() =>
      guard.canActivate(
        context('POST', {
          origin: 'https://app.example.com',
          'content-type': 'text/plain',
        }),
      ),
    ).toThrow(UnsupportedMediaTypeException)
  })
})
