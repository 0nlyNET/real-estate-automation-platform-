import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignLeadDto {
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string | null;

  @IsOptional()
  @IsUUID()
  assignedToTeamId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedTo?: string | null;
}
