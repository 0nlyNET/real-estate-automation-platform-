import { IsBoolean, IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '../../common/rbac';

export class CreateTeamUserDto {
  @IsEmail() email!: string;
  @IsOptional() @IsIn(['admin', 'agent', 'tc', 'read_only']) role?: UserRole;
  @IsOptional() @IsUUID() teamId?: string | null;
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
