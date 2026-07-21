import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

describe('ApplicationLifecycleState', () => {
  it('starts in the starting phase with an incomplete startup latch', () => {
    const state = new ApplicationLifecycleState()
    expect(state.phase).toBe('starting')
    expect(state.startupComplete).toBe(false)
  })

  it('moves starting to ready and irreversibly latches startup complete', () => {
    const state = new ApplicationLifecycleState()
    state.markReady()
    expect(state.phase).toBe('ready')
    expect(state.startupComplete).toBe(true)
    state.markReady()
    expect(state.phase).toBe('ready')
  })

  it.each([false, true])(
    'moves starting or ready to draining and lets only one caller win (ready=%s)',
    (ready) => {
      const state = new ApplicationLifecycleState()
      if (ready) state.markReady()
      expect(state.beginDrain()).toBe(true)
      expect(state.beginDrain()).toBe(false)
      expect(state.phase).toBe('draining')
      expect(state.startupComplete).toBe(ready)
      state.markReady()
      expect(state.phase).toBe('draining')
    },
  )
})
