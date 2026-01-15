import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { MeController } from './me.controller';

@Module({
  imports: [TenantsModule],
  controllers: [MeController],
})
export class MeModule {}
