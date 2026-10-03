import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGrantUsage } from './operator-test-grant-usage.entity';
import { OperatorTestGuard } from './operator-test.guard';
import { OperatorTestAdminService } from './operator-test-admin.service';
import { OperatorTestAdminController } from './operator-test-admin.controller';

/**
 * Operator test messaging module.
 * 
 * Provides:
 * - OperatorTestGuard: Validates grants and reserves quota transactionally.
 * - OperatorTestAdminService: Operator-restricted grant creation/revocation with audit.
 * 
 * This module is imported by CommonModule so ServiceAccessGuard can inject
 * the real guard (not optional). It is also imported by MessagingModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OperatorTestAuthorization,
      OperatorTestGrantUsage,
    ]),
  ],
  providers: [OperatorTestGuard, OperatorTestAdminService],
  controllers: [OperatorTestAdminController],
  exports: [OperatorTestGuard, OperatorTestAdminService],
})
export class OperatorTestModule {}
