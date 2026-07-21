const redisKeySegmentPattern = /^[A-Za-z0-9._-]+$/u

function assertSafeSegment(segment: string): void {
  if (!redisKeySegmentPattern.test(segment)) {
    throw new Error('Redis key segment is empty or contains unsafe characters')
  }
}

/** Builds collision-resistant Redis keys from validated literal segments. */
export class RedisKeyBuilder {
  private readonly namespace: readonly string[]

  public constructor(
    namespace: string | readonly string[],
    private readonly schema: string,
  ) {
    const namespaceSegments =
      typeof namespace === 'string' ? [namespace] : [...namespace]
    if (namespaceSegments.length === 0)
      throw new Error('Redis key namespace cannot be empty')
    for (const segment of namespaceSegments) assertSafeSegment(segment)
    assertSafeSegment(schema)
    this.namespace = Object.freeze(namespaceSegments)
  }

  /**
   * Builds one key without accepting separators or cluster hash braces.
   *
   * @throws Error when the resource or any additional segment is unsafe.
   */
  public build(resource: string, ...segments: readonly string[]): string {
    assertSafeSegment(resource)
    for (const segment of segments) assertSafeSegment(segment)
    return [...this.namespace, this.schema, resource, ...segments].join(':')
  }
}
