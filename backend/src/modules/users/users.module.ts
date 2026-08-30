import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../../common/common.module';
import { TenantsModule } from '../tenants/tenants.module';
import { Team } from '../teams/team.entity';
import { MailModule } from '../../mail/mail.module';
import { AccountInvitation } from '../auth/account-invitation.entity';
import { TeamInvitationsService } from './team-invitations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Team, AccountInvitation]),
    CommonModule,
    TenantsModule,
    MailModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, TeamInvitationsService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
