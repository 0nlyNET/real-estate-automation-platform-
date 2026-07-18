import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../../common/common.module';
import { TenantsModule } from '../tenants/tenants.module';
import { Team } from '../teams/team.entity';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Team]),
    CommonModule,
    TenantsModule,
    MailModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
