import { Module } from '@nestjs/common'

/**
 * Определяет compile-only composition root будущего API process.
 *
 * @remarks
 * Foundation slice намеренно не содержит controllers, providers или runtime
 * bootstrap. Они добавляются следующими independently verified slices.
 */
@Module({})
export class ApiModule {}
