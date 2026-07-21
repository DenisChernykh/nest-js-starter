import type { NextFunction, Request, Response } from 'express'

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@/platform/http/context/request-id'
import { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'

describe('request ID policy', () => {
  const generated = '019219c3-dc52-7cc1-9e70-f293ca14c198'

  it.each([
    '019219c3-dc52-7cc1-9e70-f293ca14c198',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ])('accepts canonical identifier %s', (candidate) => {
    expect(resolveRequestId(candidate, () => generated)).toEqual({
      requestId: candidate,
      accepted: true,
    })
  })

  it.each([
    '01arz3ndektsv4rrffq69g5fav',
    ' 01ARZ3NDEKTSV4RRFFQ69G5FAV',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV ',
    '81ARZ3NDEKTSV4RRFFQ69G5FAV',
    '01ARZ3NDEKTSV4RRFFQ69G5FAI',
    '019219c3-dc52-7cc1-9e70-f293ca14c198,other',
    'x'.repeat(65),
    'arbitrary',
  ])('replaces rejected identifier %s', (candidate) => {
    expect(resolveRequestId(candidate, () => generated)).toEqual({
      requestId: generated,
      accepted: false,
    })
  })

  it('rejects missing and multi-value headers', () => {
    expect(resolveRequestId(undefined, () => generated).accepted).toBe(false)
    expect(
      resolveRequestId(
        ['019219c3-dc52-7cc1-9e70-f293ca14c198'],
        () => generated,
      ).accepted,
    ).toBe(false)
  })

  it('echoes an accepted value and replaces a rejected value before next', () => {
    const context = new RequestContext()
    const setHeader = jest.fn()
    const next = jest.fn(() => {
      expect(context.getRequestId()).toBe(
        '019219c3-dc52-7cc1-9e70-f293ca14c198',
      )
    })
    const middleware = createRequestContextMiddleware(context, () => generated)

    middleware(
      {
        headers: {
          'x-request-id': '019219c3-dc52-7cc1-9e70-f293ca14c198',
        },
      } as unknown as Request,
      { setHeader } as unknown as Response,
      next as NextFunction,
    )

    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      '019219c3-dc52-7cc1-9e70-f293ca14c198',
    )
    expect(next).toHaveBeenCalledTimes(1)

    setHeader.mockClear()
    middleware(
      { headers: { 'x-request-id': 'not-trusted' } } as unknown as Request,
      { setHeader } as unknown as Response,
      jest.fn() as NextFunction,
    )
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, generated)
  })
})
