import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';

export class CreateSupportTicketDto {
  @IsString() @MinLength(1) @MaxLength(255) subject!: string;
  @IsString() @MinLength(1) @MaxLength(5000) message!: string;
  @IsOptional() @IsString() @MaxLength(255) name?: string | null;

  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent'])
  severity?: 'low' | 'normal' | 'high' | 'urgent';
}

export class AccountRequestDto {
  @IsOptional() @IsDateString()
  requestedEffectiveDate?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  note?: string;
}

export class UpdateSupportTicketDto {
  @IsOptional() @IsIn(['open', 'acknowledged', 'resolved', 'closed'])
  status?: 'open' | 'acknowledged' | 'resolved' | 'closed';

  @IsOptional() @IsUUID()
  assignedOperatorId?: string | null;

  @IsOptional() @IsDateString()
  dueAt?: string | null;

  @IsOptional() @IsString() @MaxLength(5000)
  resolutionNote?: string | null;
}
