import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGrantUsage } from './operator-test-grant-usage.entity';
import { OperatorTestGuard } from './operator-test.guard';
import { OperatorTestAdminService } from './operator-test-admin.service';

/**
 * Operator test messaging module.
 * 
 * Provides:
 * - OperatorTestGuard: Validates grants and reserves quota transactionally.
 * - OperatorTestAdminService: Operator-restricted grant creation/revocation with audit.
 * 
 * Note: The admin controller is NOT included here to avoid a circular
 * dependency with CommonModule (which provides PlatformOperatorGuard).
 * Grant management controller is registered in AdminModule.
 * 
 * This module is imported by CommonModule so ServiceAccessGuard can inject
 * the real guard. It is also imported by MessagingModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OperatorTestAuthorization,
      OperatorTestGrantUsage,
      AuditLog,
    ]),
  ],
  providers: [OperatorTestGuard, OperatorTestAdminService],
  exports: [OperatorTestGuard, OperatorTestAdminService],
})
export class OperatorTestModule {}
