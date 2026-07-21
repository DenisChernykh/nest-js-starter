import type { NextFunction, Request, Response } from 'express'

import { createTrafficGateMiddleware } from '@/platform/http/bootstrap/traffic-gate.middleware'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

function invoke(
  path: string,
  lifecycle: ApplicationLifecycleState,
): {
  readonly next: jest.Mock
  readonly status: jest.Mock
  readonly json: jest.Mock
} {
  const next = jest.fn()
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  createTrafficGateMiddleware(lifecycle)(
    { path } as Request,
    { status } as unknown as Response,
    next as NextFunction,
  )
  return { next, status, json }
}

describe('traffic gate middleware', () => {
  it('keeps health endpoints accessible during startup and drain', () => {
    const lifecycle = new ApplicationLifecycleState()
    expect(invoke('/health/ready', lifecycle).next).toHaveBeenCalledTimes(1)
    lifecycle.beginDrain()
    expect(invoke('/health/live', lifecycle).next).toHaveBeenCalledTimes(1)
  })

  it('admits application traffic only while ready', () => {
    const lifecycle = new ApplicationLifecycleState()
    const starting = invoke('/v1/technical', lifecycle)
    expect(starting.status).toHaveBeenCalledWith(503)
    expect(starting.json).toHaveBeenCalledWith({ status: 'unavailable' })
    lifecycle.markReady()
    expect(invoke('/v1/technical', lifecycle).next).toHaveBeenCalledTimes(1)
    lifecycle.beginDrain()
    expect(invoke('/v1/technical', lifecycle).status).toHaveBeenCalledWith(503)
  })
})
