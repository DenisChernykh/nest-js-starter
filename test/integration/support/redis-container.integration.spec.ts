import {
  getRedactedRedisConnectionUrl,
  startRedisContainer,
} from './redis-container'

describe('Redis test container support', () => {
  it('starts only after authenticated readiness and redacts its URL', async () => {
    const container = await startRedisContainer()
    try {
      expect(getRedactedRedisConnectionUrl(container)).toContain(
        ':\u00255Bredacted\u00255D@',
      )
    } finally {
      await container.stop()
    }
  })
})
