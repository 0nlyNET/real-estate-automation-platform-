import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../../common/common.module';
import { TenantsModule } from '../tenants/tenants.module';
import { Team } from '../teams/team.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Team]), CommonModule, TenantsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
