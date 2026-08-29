export interface SessionGenerationPort {
  incrementSessionGeneration(userId: string): Promise<bigint>
}

export const SESSION_GENERATION: unique symbol = Symbol('SESSION_GENERATION')
