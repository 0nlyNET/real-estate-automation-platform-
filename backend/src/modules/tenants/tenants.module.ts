import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsService } from './tenants.service';
import { Tenants } from './tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenants])],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
