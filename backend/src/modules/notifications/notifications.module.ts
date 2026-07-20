import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AuditLog } from '../audit/audit-log.entity';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { User } from '../users/user.entity';
import { HealthMonitorService } from './health-monitor.service';
import { AdminNotification } from './notification.entity';
import { AdminNotificationPreference } from './notification-preference.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdminPushSubscription } from './push-subscription.entity';
import { RetentionService } from './retention.service';
import { OperationsTask } from '../operations/operations-task.entity';
import { ProspectApplication } from '../public/prospect-application.entity';
import { OperationalRemindersService } from './operational-reminders.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminNotification,
      AdminNotificationPreference,
      AdminPushSubscription,
      User,
      AuditLog,
      StripeWebhookEvent,
      OperationsTask,
      ProspectApplication,
    ]),
    CommonModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RetentionService,
    HealthMonitorService,
    OperationalRemindersService,
  ],
  exports: [NotificationsService, RetentionService],
})
export class NotificationsModule {}
