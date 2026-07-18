import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), CommonModule],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [TypeOrmModule, AuditService, AuditInterceptor],
})
export class AuditModule {}
