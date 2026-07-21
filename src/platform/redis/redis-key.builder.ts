const redisKeySegmentPattern = /^[A-Za-z0-9._-]+$/u

function assertSafeSegment(segment: string): void {
  if (!redisKeySegmentPattern.test(segment)) {
    throw new Error('Redis key segment is empty or contains unsafe characters')
  }
}

/** Builds collision-resistant Redis keys from validated literal segments. */
export class RedisKeyBuilder {
  public constructor(
    private readonly namespace: string,
    private readonly schema: string,
  ) {
    assertSafeSegment(namespace)
    assertSafeSegment(schema)
  }

  /**
   * Builds one key without accepting separators or cluster hash braces.
   *
   * @throws Error when the resource or any additional segment is unsafe.
   */
  public build(resource: string, ...segments: readonly string[]): string {
    assertSafeSegment(resource)
    for (const segment of segments) assertSafeSegment(segment)
    return [this.namespace, this.schema, resource, ...segments].join(':')
  }
}
