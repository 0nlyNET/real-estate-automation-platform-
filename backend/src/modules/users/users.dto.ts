import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { UserRole } from '../../common/rbac';

export class CreateTeamUserDto {
  @IsEmail() email!: string;
  @IsOptional() @IsIn(['admin', 'agent', 'tc', 'read_only']) role?: UserRole;
  @IsOptional() @IsUUID() teamId?: string | null;
  @IsOptional() @IsString() @MinLength(12) tempPassword?: string;
}

export class UpdateUserRoleDto {
  @IsIn(['admin', 'agent', 'tc', 'read_only']) role!: UserRole;
}

export class UpdateUserTeamDto {
  @IsOptional() @IsUUID() teamId?: string | null;
}

export class UpdateUserActiveDto {
  @IsBoolean() isActive!: boolean;
}
