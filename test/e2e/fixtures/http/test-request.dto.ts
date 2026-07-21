import { IsString, MinLength } from 'class-validator'

export class TestRequestDto {
  @IsString()
  @MinLength(2)
  public value!: string
}
