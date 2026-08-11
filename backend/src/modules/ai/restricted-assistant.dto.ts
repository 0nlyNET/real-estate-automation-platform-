import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskRestrictedAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4_000)
  prompt!: string;
}
