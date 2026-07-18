import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString() @MinLength(1) @MaxLength(255) subject!: string;
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
  @IsOptional() @IsString() @MaxLength(255) name?: string | null;
}
