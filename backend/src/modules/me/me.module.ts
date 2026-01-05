import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { MeController } from './me.controller';

@Module({
  imports: [UsersModule, TenantsModule],
  controllers: [MeController],
})
export class MeModule {}
