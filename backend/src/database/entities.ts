import { AgentPresence } from "../modules/presence/agent-presence.entity";
import { AuditLog } from "../modules/audit/audit-log.entity";
import { ComplianceEvent } from "../modules/compliance/compliance-event.entity";
import { ComplianceOptOut } from "../modules/compliance/compliance-optout.entity";
import { Credential } from "../modules/settings/credential.entity";
import { Lead } from "../modules/leads/lead.entity";
import { LeadEvent } from "../modules/leads/lead-event.entity";
import { Message } from "../modules/messaging/message.entity";
import { PasswordResetToken } from "../modules/auth/password-reset-token.entity";
import { RoutingAssignmentLog } from "../modules/routing/routing-assignment-log.entity";
import { RoutingRule } from "../modules/routing/routing-rule.entity";
import { Sequence } from "../modules/sequences/sequence.entity";
import { SequenceEnrollment } from "../modules/sequences/sequence-enrollment.entity";
import { SequenceStep } from "../modules/sequences/sequence-step.entity";
import { SupportTicket } from "../modules/support/support-ticket.entity";
import { Team } from "../modules/teams/team.entity";
import { Tenant } from "../modules/tenants/tenant.entity";
import { TenantQuietHours } from "../modules/compliance/tenant-quiet-hours.entity";
import { TenantSettings } from "../modules/settings/tenant-settings.entity";
import { User } from "../modules/users/user.entity";
import { ProspectApplication } from '../modules/public/prospect-application.entity';
import { StripeWebhookEvent } from '../modules/billing/stripe-webhook-event.entity';
import { OnboardingRecord } from '../modules/onboarding/onboarding-record.entity';
import { OperationsTask } from '../modules/operations/operations-task.entity';
import { LeadConsentRecord } from '../modules/compliance/lead-consent-record.entity';
import { LeadStageEvent } from '../modules/leads/lead-stage-event.entity';
import { AdminNotification } from '../modules/notifications/notification.entity';
import { AdminNotificationPreference } from '../modules/notifications/notification-preference.entity';
import { AdminPushSubscription } from '../modules/notifications/push-subscription.entity';
import { BillingEvent } from '../modules/billing/billing-event.entity';
import { LeadHandoff } from '../modules/client-operations/lead-handoff.entity';
import { Appointment } from '../modules/client-operations/appointment.entity';
import { WorkspaceAiSettings } from '../modules/ai/workspace-ai-settings.entity';
import { BrokerageKnowledge } from '../modules/ai/brokerage-knowledge.entity';
import { ConversationAiState } from '../modules/ai/conversation-ai-state.entity';
import { AiRun } from '../modules/ai/ai-run.entity';
import { PlatformAiControl } from '../modules/ai/platform-ai-control.entity';
import { PlatformCredential } from '../modules/integrations/platform-credential.entity';
import { LeadIngestionEvent } from '../modules/lead-ingestion/lead-ingestion-event.entity';
import { TwilioInboundMessage } from '../modules/webhooks/twilio-inbound-message.entity';
import { SendGridWebhookEvent } from '../modules/webhooks/sendgrid-webhook-event.entity';
import { UsageBucket } from '../modules/limits/usage-bucket.entity';
import { UsagePolicy } from '../modules/limits/usage-policy.entity';
import { UsageReservation } from '../modules/limits/usage-reservation.entity';
import { CommunicationSuppression } from '../modules/compliance/communication-suppression.entity';
import { TenantMessagingResource } from '../modules/integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../modules/integrations/tenant-email-identity.entity';
import { DurableJob } from '../modules/durable-jobs/durable-job.entity';
import { TestRun } from '../modules/testing/test-run.entity';
import { OffboardingRequest } from '../modules/offboarding/offboarding-request.entity';
import { SendDecision } from '../modules/messaging/send-decision.entity';
import { AccountInvitation } from '../modules/auth/account-invitation.entity';
import { TenantIntegrationConnection } from '../modules/crm-events/tenant-integration-connection.entity';
import { IntegrationIngressEvent } from '../modules/crm-events/integration-ingress-event.entity';
import { TenantWebhookSubscription } from '../modules/crm-events/tenant-webhook-subscription.entity';
import { IntegrationDeliveryEvent } from '../modules/crm-events/integration-delivery-event.entity';
import { AssistantRun } from '../modules/ai/assistant-run.entity';

export const databaseEntities = [
  Tenant,
  User,
  Team,
  Lead,
  LeadEvent,
  Message,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
  Credential,
  PlatformCredential,
  TenantMessagingResource,
  TenantEmailIdentity,
  LeadIngestionEvent,
  TwilioInboundMessage,
  SendGridWebhookEvent,
  TenantSettings,
  RoutingRule,
  RoutingAssignmentLog,
  AgentPresence,
  ComplianceOptOut,
  CommunicationSuppression,
  ComplianceEvent,
  TenantQuietHours,
  PasswordResetToken,
  SupportTicket,
  AuditLog,
  ProspectApplication,
  StripeWebhookEvent,
  OnboardingRecord,
  OperationsTask,
  LeadConsentRecord,
  LeadStageEvent,
  AdminNotification,
  AdminNotificationPreference,
  AdminPushSubscription,
  BillingEvent,
  LeadHandoff,
  Appointment,
  WorkspaceAiSettings,
  BrokerageKnowledge,
  ConversationAiState,
  AiRun,
  PlatformAiControl,
  UsagePolicy,
  UsageBucket,
  UsageReservation,
  DurableJob,
  TestRun,
  OffboardingRequest,
  SendDecision,
  AccountInvitation,
  TenantIntegrationConnection,
  IntegrationIngressEvent,
  TenantWebhookSubscription,
  IntegrationDeliveryEvent,
  AssistantRun,
] as const;
