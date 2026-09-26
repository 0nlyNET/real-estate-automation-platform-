import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { User } from '../users/user.entity';
import { HealthMonitorService } from './health-monitor.service';
import { AdminNotification } from './notification.entity';
import { NotificationDigestService } from './notification-digest.service';
import { NotificationIncident } from './notification-incident.entity';
import { NotificationIncidentsService } from './notification-incidents.service';
import { AdminNotificationPreference } from './notification-preference.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdminPushSubscription } from './push-subscription.entity';
import { OperationalEventsService } from './operational-events.service';
import { RetentionService } from './retention.service';
import { OperationsTask } from '../operations/operations-task.entity';
import { ProspectApplication } from '../public/prospect-application.entity';
import { OperationalRemindersService } from './operational-reminders.service';
import { ClientNotificationsController } from './client-notifications.controller';
import { AiRun } from '../ai/ai-run.entity';
import { Message } from '../messaging/message.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { Lead } from '../leads/lead.entity';
import { Appointment } from '../client-operations/appointment.entity';
import { Tenant } from '../tenants/tenant.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminNotification,
      AdminNotificationPreference,
      AdminPushSubscription,
      NotificationIncident,
      User,
      StripeWebhookEvent,
      OperationsTask,
      ProspectApplication,
      AiRun,
      Message,
      SequenceEnrollment,
      TenantMessagingResource,
      TenantEmailIdentity,
      Lead,
      Appointment,
      Tenant,
    ]),
    CommonModule,
    MailModule,
  ],
  controllers: [NotificationsController, ClientNotificationsController],
  providers: [
    NotificationsService,
    NotificationIncidentsService,
    NotificationDigestService,
    OperationalEventsService,
    RetentionService,
    HealthMonitorService,
    OperationalRemindersService,
  ],
  exports: [
    NotificationsService,
    NotificationIncidentsService,
    NotificationDigestService,
    OperationalEventsService,
    RetentionService,
  ],
})
export class NotificationsModule {}
