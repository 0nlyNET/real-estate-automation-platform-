import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { ClientOperationsModule } from '../client-operations/client-operations.module';
import { Appointment } from '../client-operations/appointment.entity';
import { LeadHandoff } from '../client-operations/lead-handoff.entity';
import { ComplianceModule } from '../compliance/compliance.module';
import { Credential } from '../settings/credential.entity';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { SequencesModule } from '../sequences/sequences.module';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { AdminAiController } from './admin-ai.controller';
import { AiAuditService } from './ai-audit.service';
import { AiConfigurationService } from './ai-configuration.service';
import { AiConversationControlService } from './ai-conversation-control.service';
import { AiConversationService } from './ai-conversation.service';
import { AiPolicyService } from './ai-policy.service';
import { AiRun } from './ai-run.entity';
import { AiToolService } from './ai-tool.service';
import { AI_PROVIDER } from './ai.types';
import { AiUsageService } from './ai-usage.service';
import { AiController } from './ai.controller';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { OpenAiProvider } from './openai.provider';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { LimitsModule } from '../limits/limits.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StatsModule } from '../stats/stats.module';
import { SettingsModule } from '../settings/settings.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { DurableJob } from '../durable-jobs/durable-job.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { AssistantRun } from './assistant-run.entity';
import { RestrictedAssistantProvider } from './restricted-assistant.provider';
import { RestrictedAssistantService } from './restricted-assistant.service';
import { ClientAssistantController, OperationsAssistantController } from './restricted-assistant.controller';
import { AiSetupService } from './ai-setup.service';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkspaceAiSettings,
      BrokerageKnowledge,
      ConversationAiState,
      AiRun,
      PlatformAiControl,
      Lead,
      LeadEvent,
      Message,
      Credential,
      TenantSettings,
      Tenant,
      User,
      LeadHandoff,
      Appointment,
      AssistantRun,
      DurableJob,
      OperationsTask,
    ]),
    CommonModule,
    AuditModule,
    ComplianceModule,
    EntitlementsModule,
    ClientOperationsModule,
    SequencesModule,
    LimitsModule,
    IntegrationsModule,
    StatsModule,
    SettingsModule,
    OnboardingModule,
    CalendarModule,
  ],
  controllers: [AiController, AdminAiController, ClientAssistantController, OperationsAssistantController],
  providers: [
    AiConfigurationService,
    AiConversationControlService,
    AiConversationService,
    AiPolicyService,
    AiToolService,
    AiUsageService,
    AiAuditService,
    OpenAiProvider,
    RestrictedAssistantProvider,
    RestrictedAssistantService,
    AiSetupService,
    { provide: AI_PROVIDER, useExisting: OpenAiProvider },
  ],
  exports: [
    AiConfigurationService,
    AiConversationControlService,
    AiConversationService,
    AiSetupService,
  ],
})
export class AiModule {}
