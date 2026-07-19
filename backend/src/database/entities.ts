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
  TenantSettings,
  RoutingRule,
  RoutingAssignmentLog,
  AgentPresence,
  ComplianceOptOut,
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
] as const;
