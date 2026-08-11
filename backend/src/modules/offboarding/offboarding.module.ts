import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffboardingRequest } from './offboarding-request.entity';
import { OffboardingService } from './offboarding.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([OffboardingRequest]), AuditModule],
  providers: [OffboardingService],
  exports: [OffboardingService],
})
export class OffboardingModule {}
