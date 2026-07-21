import { EventEmitter } from 'node:events'

import type { Request, Response } from 'express'

import { ActiveRequestTracker } from '@/platform/http/bootstrap/active-request-tracker'

describe('ActiveRequestTracker', () => {
  it('excludes live/startup and decrements finish/close exactly once', async () => {
    const tracker = new ActiveRequestTracker()
    const trivial = new EventEmitter()
    tracker.middleware()(
      { path: '/health/live' } as Request,
      trivial as Response,
      jest.fn(),
    )
    expect(tracker.activeCount).toBe(0)
    const response = new EventEmitter()
    tracker.middleware()(
      { path: '/health/ready' } as Request,
      response as Response,
      jest.fn(),
    )
    expect(tracker.activeCount).toBe(1)
    const waiting = tracker.waitForIdle(AbortSignal.timeout(100))
    response.emit('finish')
    response.emit('close')
    await expect(waiting).resolves.toBe(true)
    expect(tracker.activeCount).toBe(0)
  })
})
