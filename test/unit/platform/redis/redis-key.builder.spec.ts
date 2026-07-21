import { RedisKeyBuilder } from '@/platform/redis/redis-key.builder'

describe('RedisKeyBuilder', () => {
  it('builds one namespace/schema/resource key from validated segments', () => {
    const builder = new RedisKeyBuilder('starter', 'v1')

    expect(builder.build('catalog', 'item', '42')).toBe(
      'starter:v1:catalog:item:42',
    )
  })

  it.each(['', 'with:colon', 'with{brace', 'with}brace'])(
    'rejects unsafe segment %j',
    (segment) => {
      expect(() => new RedisKeyBuilder(segment, 'v1')).toThrow()
      expect(() => new RedisKeyBuilder('starter', segment)).toThrow()
      expect(() =>
        new RedisKeyBuilder('starter', 'v1').build('catalog', segment),
      ).toThrow()
    },
  )
})
