import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AskRestrictedAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4_000)
  prompt!: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
