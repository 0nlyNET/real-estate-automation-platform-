import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateOperationsTaskDto {
  @IsOptional()
  @IsIn(['open', 'in_progress', 'blocked', 'resolved'])
  status?: 'open' | 'in_progress' | 'blocked' | 'resolved';

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'critical'])
  priority?: 'low' | 'normal' | 'high' | 'critical';

  @IsOptional()
  @IsUUID()
  assignedOperatorId?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  evidenceNote?: string | null;
}
