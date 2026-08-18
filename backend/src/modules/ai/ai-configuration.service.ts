import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import { Credential } from '../settings/credential.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { AiAuditService } from './ai-audit.service';
import {
  UpdateAiSettingsDto,
  UpdateBrokerageKnowledgeDto,
} from './ai.dto';
import { AiUsageService } from './ai-usage.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { ProviderConfigService } from '../integrations/provider-config.service';
import { BookingProviderRegistry } from '../calendar/booking-provider.registry';

type ConfigurationActor = {
  userId: string;
  email?: string | null;
};

const SETTINGS_FIELDS_REQUIRING_APPROVAL: Array<keyof UpdateAiSettingsDto> = [
  'responseMode',
  'aiFirstResponderEnabled',
  'allowedChannels',
  'tone',
  'bookingBehavior',
  'identityLabel',
  'maximumAutomaticTurns',
  'minimumConfidenceThreshold',
  'allowedTopics',
  'escalationRules',
  'perConversationUsageLimit',
  'monthlyWorkspaceUsageLimit',
];

@Injectable()
export class AiConfigurationService {
  constructor(
    @InjectRepository(WorkspaceAiSettings)
    private readonly settings: Repository<WorkspaceAiSettings>,
    @InjectRepository(BrokerageKnowledge)
    private readonly knowledge: Repository<BrokerageKnowledge>,
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettings: Repository<TenantSettings>,
    private readonly usage: AiUsageService,
    private readonly audit: AiAuditService,
    @Optional() private readonly providerConfig?: ProviderConfigService,
    @Optional() private readonly bookingProviders?: BookingProviderRegistry,
  ) {}

  async getConfiguration(tenantId: string) {
    const [settings, knowledge, usage, communications, tenantSettings, bookingStatus] =
      await Promise.all([
        this.getOrCreateSettings(tenantId),
        this.getOrCreateKnowledge(tenantId),
        this.usage.usageForWorkspace(tenantId),
        this.communicationReadiness(tenantId),
        this.tenantSettings.findOne({ where: { tenantId } }),
        this.bookingProviders?.status(tenantId) || Promise.resolve(null),
      ]);
    return {
      assistantStatus:
        settings.aiEnabled && !settings.aiPaused ? 'active' : 'paused',
      settings,
      knowledge,
      usage: {
        ...usage,
        monthlyLimit: settings.monthlyWorkspaceUsageLimit,
      },
      readiness: {
        providerConfigured: Boolean(
          String(process.env.OPENAI_API_KEY || '').trim(),
        ),
        communications,
        verifiedBookingLink: Boolean(
          tenantSettings?.bookingLink &&
            tenantSettings.bookingLinkVerifiedAt,
        ),
        bookingProviderConnected: bookingStatus?.connected === true,
        activeBookingProvider: bookingStatus?.activeProvider || null,
        googleCalendarConnected:
          bookingStatus?.providers.google_calendar.connected === true,
      },
    };
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateAiSettingsDto,
    actor: ConfigurationActor,
  ) {
    const settings = await this.getOrCreateSettings(tenantId);
    const changedApprovalField = SETTINGS_FIELDS_REQUIRING_APPROVAL.some(
      (field) =>
        dto[field] !== undefined &&
        JSON.stringify(dto[field]) !==
          JSON.stringify(settings[field as keyof WorkspaceAiSettings]),
    );
    if (
      dto.responseMode === 'controlled_autopilot' &&
      dto.confirmControlledAutopilot !== true
    ) {
      throw new BadRequestException(
        'Controlled autopilot requires explicit confirmation.',
      );
    }
    if (dto.bookingBehavior === 'calendar_booking') {
      await this.assertCalendarReady(tenantId);
    }
    if (changedApprovalField && dto.aiEnabled === true) {
      throw new ConflictException(
        'Save and approve the changed AI configuration before enabling it.',
      );
    }

    if (dto.responseMode !== undefined) settings.responseMode = dto.responseMode;
    if (dto.aiFirstResponderEnabled !== undefined) {
      settings.aiFirstResponderEnabled = dto.aiFirstResponderEnabled;
    }
    if (dto.allowedChannels !== undefined) {
      settings.allowedChannels = [...new Set(dto.allowedChannels)];
    }
    if (dto.tone !== undefined) settings.tone = dto.tone;
    if (dto.bookingBehavior !== undefined) settings.bookingBehavior = dto.bookingBehavior;
    if (dto.identityLabel !== undefined) {
      settings.identityLabel = dto.identityLabel.trim() || null;
    }
    if (dto.maximumAutomaticTurns !== undefined) {
      settings.maximumAutomaticTurns = dto.maximumAutomaticTurns;
    }
    if (dto.minimumConfidenceThreshold !== undefined) {
      settings.minimumConfidenceThreshold = dto.minimumConfidenceThreshold;
    }
    if (dto.allowedTopics !== undefined) {
      settings.allowedTopics = this.cleanStringList(dto.allowedTopics, 40, 160);
    }
    if (dto.escalationRules !== undefined) {
      settings.escalationRules = dto.escalationRules;
    }
    if (dto.perConversationUsageLimit !== undefined) {
      settings.perConversationUsageLimit = dto.perConversationUsageLimit;
    }
    if (dto.monthlyWorkspaceUsageLimit !== undefined) {
      settings.monthlyWorkspaceUsageLimit = dto.monthlyWorkspaceUsageLimit;
    }
    if (changedApprovalField) {
      settings.configurationApprovalStatus = 'draft';
      settings.configurationApprovedAt = null;
      settings.configurationApprovedById = null;
      settings.aiEnabled = false;
      settings.lastConfigurationUpdate = new Date();
    }
    if (dto.responseMode === 'human_only') settings.aiEnabled = false;
    if (dto.aiEnabled === false) settings.aiEnabled = false;
    if (dto.aiEnabled === true) {
      await this.assertCanEnable(tenantId, settings);
      settings.aiEnabled = true;
    }
    await this.settings.save(settings);
    await this.audit.recordHuman({
      tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ai_configuration_updated',
      leadId: '00000000-0000-0000-0000-000000000000',
      metadata: {
        responseMode: settings.responseMode,
        aiEnabled: settings.aiEnabled,
        approvalStatus: settings.configurationApprovalStatus,
      },
    });
    return this.getConfiguration(tenantId);
  }

  async approveSettings(tenantId: string, actor: ConfigurationActor) {
    const settings = await this.getOrCreateSettings(tenantId);
    const knowledge = await this.getOrCreateKnowledge(tenantId);
    if (!settings.identityLabel?.trim()) {
      throw new ConflictException('Set the approved AI identity first.');
    }
    if (settings.responseMode === 'human_only') {
      throw new ConflictException('Choose draft or controlled autopilot first.');
    }
    if (knowledge.approvalStatus !== 'approved') {
      throw new ConflictException('Approve brokerage information first.');
    }
    const communications = await this.communicationReadiness(tenantId);
    if (!this.allowedChannels(settings).some((channel) => communications[channel])) {
      throw new ConflictException(
        'Connect and successfully test at least one AI-allowed messaging channel first.',
      );
    }
    if (!String(process.env.OPENAI_API_KEY || '').trim()) {
      throw new ConflictException('The AI provider is not configured.');
    }
    if (settings.bookingBehavior === 'calendar_booking') {
      await this.assertCalendarReady(tenantId);
    }
    settings.configurationApprovalStatus = 'approved';
    settings.configurationApprovedAt = new Date();
    settings.configurationApprovedById = actor.userId;
    await this.settings.save(settings);
    await this.audit.recordHuman({
      tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ai_configuration_approved',
      leadId: '00000000-0000-0000-0000-000000000000',
      metadata: { responseMode: settings.responseMode },
    });
    return this.getConfiguration(tenantId);
  }

  async updateKnowledge(
    tenantId: string,
    dto: UpdateBrokerageKnowledgeDto,
    actor: ConfigurationActor,
  ) {
    const knowledge = await this.getOrCreateKnowledge(tenantId);
    if (dto.publicName !== undefined) {
      knowledge.publicName = dto.publicName.trim() || null;
    }
    if (dto.officeEmail !== undefined) {
      knowledge.officeEmail = dto.officeEmail.trim().toLowerCase() || null;
    }
    if (dto.officePhone !== undefined) {
      knowledge.officePhone = dto.officePhone.trim() || null;
    }
    if (dto.serviceAreas !== undefined) {
      knowledge.serviceAreas = this.cleanStringList(dto.serviceAreas, 100, 160);
    }
    if (dto.businessHours !== undefined) {
      knowledge.businessHours = Object.fromEntries(
        Object.entries(dto.businessHours)
          .slice(0, 14)
          .map(([key, value]) => [
            String(key).slice(0, 30),
            String(value).slice(0, 160),
          ]),
      );
    }
    if (dto.schedulingInstructions !== undefined) {
      knowledge.schedulingInstructions =
        dto.schedulingInstructions.trim() || null;
    }
    if (dto.approvedFaqs !== undefined) {
      knowledge.approvedFaqs = dto.approvedFaqs.slice(0, 100).map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      }));
    }
    if (dto.escalationInstructions !== undefined) {
      knowledge.escalationInstructions =
        dto.escalationInstructions.trim() || null;
    }
    if (dto.qualificationQuestions !== undefined) {
      knowledge.qualificationQuestions = this.cleanStringList(
        dto.qualificationQuestions,
        30,
        300,
      );
    }
    if (dto.prohibitedTopics !== undefined) {
      knowledge.prohibitedTopics = this.cleanStringList(
        dto.prohibitedTopics,
        100,
        160,
      );
    }
    if (dto.agentRoster !== undefined) {
      knowledge.agentRoster = dto.agentRoster.slice(0, 100).map((agent) => ({
        id: agent.id?.trim(),
        name: agent.name.trim(),
        title: agent.title?.trim(),
        serviceAreas: this.cleanStringList(
          agent.serviceAreas || [],
          30,
          160,
        ),
      }));
    }
    if (dto.routingRules !== undefined) knowledge.routingRules = dto.routingRules;
    if (dto.requiredDisclaimer !== undefined) {
      knowledge.requiredDisclaimer = dto.requiredDisclaimer.trim() || null;
    }
    knowledge.approvalStatus = 'draft';
    knowledge.approvedAt = null;
    knowledge.approvedById = null;
    await this.knowledge.save(knowledge);

    const settings = await this.getOrCreateSettings(tenantId);
    settings.aiEnabled = false;
    settings.configurationApprovalStatus = 'draft';
    settings.configurationApprovedAt = null;
    settings.configurationApprovedById = null;
    settings.lastConfigurationUpdate = new Date();
    await this.settings.save(settings);
    await this.audit.recordHuman({
      tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ai_knowledge_updated',
      leadId: '00000000-0000-0000-0000-000000000000',
      metadata: { approvalStatus: 'draft', aiDisabled: true },
    });
    return this.getConfiguration(tenantId);
  }

  async approveKnowledge(tenantId: string, actor: ConfigurationActor) {
    const knowledge = await this.getOrCreateKnowledge(tenantId);
    if (!knowledge.publicName?.trim()) {
      throw new ConflictException('Public brokerage or team name is required.');
    }
    if (!knowledge.serviceAreas?.length) {
      throw new ConflictException('At least one approved service area is required.');
    }
    knowledge.approvalStatus = 'approved';
    knowledge.approvedAt = new Date();
    knowledge.approvedById = actor.userId;
    await this.knowledge.save(knowledge);
    await this.audit.recordHuman({
      tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'ai_knowledge_approved',
      leadId: '00000000-0000-0000-0000-000000000000',
      metadata: { knowledgeId: knowledge.id },
    });
    return this.getConfiguration(tenantId);
  }

  private async assertCanEnable(
    tenantId: string,
    settings: WorkspaceAiSettings,
  ) {
    const knowledge = await this.getOrCreateKnowledge(tenantId);
    if (
      settings.responseMode === 'human_only' ||
      settings.configurationApprovalStatus !== 'approved' ||
      knowledge.approvalStatus !== 'approved' ||
      !settings.identityLabel?.trim()
    ) {
      throw new ConflictException(
        'Approved AI settings, identity, and brokerage information are required.',
      );
    }
    if (!String(process.env.OPENAI_API_KEY || '').trim()) {
      throw new ConflictException('The AI provider is not configured.');
    }
    const communications = await this.communicationReadiness(tenantId);
    if (!this.allowedChannels(settings).some((channel) => communications[channel])) {
      throw new ConflictException(
        'A successfully tested AI-allowed messaging integration is required.',
      );
    }
    if (settings.bookingBehavior === 'calendar_booking') {
      await this.assertCalendarReady(tenantId);
    }
  }

  private async assertCalendarReady(tenantId: string) {
    const status = await this.bookingProviders?.status(tenantId);
    if (!status?.connected) {
      throw new ConflictException({
        code: 'CALENDAR_NEEDS_ATTENTION',
        message:
          'Choose one connected, selected, and tested appointment provider before enabling direct AI booking.',
      });
    }
  }

  private allowedChannels(settings: WorkspaceAiSettings): Array<'sms' | 'email'> {
    const values = Array.isArray(settings.allowedChannels)
      ? settings.allowedChannels.filter((value): value is 'sms' | 'email' =>
          value === 'sms' || value === 'email')
      : [];
    return values.length ? values : ['sms', 'email'];
  }

  private async communicationReadiness(tenantId: string) {
    if (this.providerConfig) {
      const [sms, email] = await Promise.all([
        this.providerConfig.resolveTwilio(tenantId, { allowTesting: true }),
        this.providerConfig.resolveSendGrid(tenantId, { allowTesting: true }),
      ]);
      return { sms: Boolean(sms), email: Boolean(email) };
    }
    const rows = await this.credentials.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    const ready = (provider: 'twilio' | 'sendgrid') => {
      const row = rows.find((item) => item.provider === provider);
      const payload = row
        ? decryptIntegrationPayload(row.encryptedValue)
        : null;
      return Boolean(
        payload?.connected &&
          !payload?.error &&
          payload?.lastSync,
      );
    };
    return { sms: ready('twilio'), email: ready('sendgrid') };
  }

  private cleanStringList(values: string[], maxItems: number, maxLength: number) {
    return [
      ...new Set(
        values
          .map((value) => String(value || '').trim().slice(0, maxLength))
          .filter(Boolean),
      ),
    ].slice(0, maxItems);
  }

  private async getOrCreateSettings(tenantId: string) {
    const existing = await this.settings.findOne({ where: { tenantId } });
    if (existing) return existing;
    try {
      return await this.settings.save(
        this.settings.create({
          tenantId,
          aiEnabled: false,
          aiFirstResponderEnabled: true,
          allowedChannels: ['sms', 'email'],
          tone: 'professional_warm',
          bookingBehavior: 'verified_link_only',
          responseMode: 'human_only',
          maximumAutomaticTurns: 6,
          minimumConfidenceThreshold: 0.82,
          allowedTopics: [],
          escalationRules: {},
          perConversationUsageLimit: 12_000,
          monthlyWorkspaceUsageLimit: 500_000,
          aiPaused: false,
          configurationApprovalStatus: 'draft',
          lastConfigurationUpdate: new Date(),
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.settings.findOneOrFail({ where: { tenantId } });
    }
  }

  private async getOrCreateKnowledge(tenantId: string) {
    const existing = await this.knowledge.findOne({ where: { tenantId } });
    if (existing) return existing;
    try {
      return await this.knowledge.save(
        this.knowledge.create({
          tenantId,
          serviceAreas: [],
          businessHours: {},
          approvedFaqs: [],
          qualificationQuestions: [],
          prohibitedTopics: [],
          agentRoster: [],
          routingRules: {},
          approvalStatus: 'draft',
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.knowledge.findOneOrFail({ where: { tenantId } });
    }
  }
}
