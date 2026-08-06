import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { formatHHMM, isWithinQuietHours, parseHHMM } from '../../common/time';
import { LeadConsentRecord } from './lead-consent-record.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { ConsentEvidenceDto, LeadConsentDto } from './consent.dto';
import { isOptOutMessage } from '../../common/opt-out';

function normalizePhone(v: string) {
  let digits = (v || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

function normalizeEmail(v: string) {
  return (v || '').trim().toLowerCase();
}

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(ComplianceOptOut)
    private readonly optRepo: Repository<ComplianceOptOut>,
    @InjectRepository(ComplianceEvent)
    private readonly evtRepo: Repository<ComplianceEvent>,
    @InjectRepository(TenantQuietHours)
    private readonly qhRepo: Repository<TenantQuietHours>,
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(LeadConsentRecord)
    private readonly consentRepo: Repository<LeadConsentRecord>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async recordLeadConsent(
    tenantId: string,
    leadId: string,
    consent?: LeadConsentDto,
    importedByUserId?: string,
  ) {
    if (!consent) return [];
    const saved: LeadConsentRecord[] = [];
    for (const channel of ['sms', 'email'] as const) {
      const evidence = consent[channel];
      if (!evidence) continue;
      saved.push(
        await this.upsertConsentEvidence(
          tenantId,
          leadId,
          channel,
          evidence,
          importedByUserId,
        ),
      );
    }
    return saved;
  }

  private async upsertConsentEvidence(
    tenantId: string,
    leadId: string,
    channel: 'sms' | 'email',
    evidence: ConsentEvidenceDto,
    importedByUserId?: string,
  ) {
    const existing = await this.consentRepo.findOne({ where: { tenantId, leadId, channel } });
    const hasDisclosure = Boolean(
      String(evidence.disclosureText || '').trim() ||
        String(evidence.disclosureVersion || '').trim(),
    );
    const sufficientlyDocumented = Boolean(
      evidence.affirmative === true &&
        String(evidence.source || '').trim() &&
        evidence.consentedAt &&
        hasDisclosure,
    );
    const row = this.consentRepo.create({
      id: existing?.id,
      tenantId,
      leadId,
      channel,
      status: sufficientlyDocumented ? 'affirmative' : 'unknown',
      source: String(evidence.source || '').trim() || null,
      disclosureText: String(evidence.disclosureText || '').trim() || null,
      disclosureVersion: String(evidence.disclosureVersion || '').trim() || null,
      consentedAt: evidence.consentedAt ? new Date(evidence.consentedAt) : null,
      captureUrl: evidence.captureUrl || null,
      sourceIdentifier: evidence.sourceIdentifier || null,
      captureIp: evidence.captureIp || null,
      importedByUserId: importedByUserId || null,
      clientAttested: evidence.clientAttested === true,
      revokedAt: null,
      revocationSource: null,
    });
    const result = await this.consentRepo.save(row);
    await this.recordEvent(tenantId, {
      type: sufficientlyDocumented ? 'consent_recorded' : 'consent_evidence_incomplete',
      channel,
      leadId,
      payload: {
        source: result.source,
        disclosureVersion: result.disclosureVersion,
        consentedAt: result.consentedAt,
        clientAttested: result.clientAttested,
      },
    });
    return result;
  }

  async communicationEligibility(
    tenantId: string,
    lead: Pick<Lead, 'id' | 'phone' | 'email'>,
    channel: 'sms' | 'email',
  ): Promise<{ allowed: boolean; code?: string; reason?: string }> {
    const destination = channel === 'sms' ? lead.phone : lead.email;
    if (!destination) {
      return { allowed: false, code: 'MISSING_DESTINATION', reason: `Lead has no ${channel} destination` };
    }
    if (await this.isOptedOut(tenantId, channel, destination)) {
      return { allowed: false, code: 'RECIPIENT_OPTED_OUT', reason: 'Recipient opted out' };
    }
    const evidence = await this.consentRepo.findOne({
      where: { tenantId, leadId: lead.id, channel },
    });
    const sufficient = Boolean(
      evidence?.status === 'affirmative' &&
        evidence.consentedAt &&
        evidence.source &&
        (evidence.disclosureText || evidence.disclosureVersion) &&
        !evidence.revokedAt,
    );
    if (!sufficient) {
      return {
        allowed: false,
        code: 'MISSING_AFFIRMATIVE_CONSENT',
        reason: `No sufficient affirmative ${channel} consent evidence`,
      };
    }
    return { allowed: true };
  }

  async listEvents(tenantId: string, take = 50, skip = 0) {
    if (!tenantId) return [];
    return this.evtRepo.find({
      where: { tenantId } as any,
      order: { createdAt: 'DESC' as any },
      take,
      skip,
    });
  }

  async recordEvent(tenantId: string, evt: Partial<ComplianceEvent>) {
    const row = this.evtRepo.create({
      tenantId,
      type: evt.type || 'event',
      channel: evt.channel || null,
      leadId: evt.leadId || null,
      userId: evt.userId || null,
      messageId: evt.messageId || null,
      to: evt.to || null,
      payload: evt.payload || null,
    } as any);
    return this.evtRepo.save(row);
  }

  async addOptOut(
    tenantId: string,
    channel: 'sms' | 'email',
    value: string,
    reason = 'user_request',
    source = 'manual',
  ) {
    const normalized = channel === 'sms' ? normalizePhone(value) : normalizeEmail(value);

    const row = this.optRepo.create({
      tenantId,
      channel,
      value: normalized,
      reason,
      source,
    });

    let saved: ComplianceOptOut;
    try {
      saved = await this.optRepo.save(row);
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      const existing = await this.optRepo.findOne({
        where: { tenantId, channel, value: normalized } as any,
      });
      if (!existing) throw error;
      return existing;
    }

    await this.recordEvent(tenantId, {
      type: 'opt_out_recorded',
      channel,
      to: normalized,
      payload: { reason, source },
    });

    const leads = await this.leadRepo.find({
      where:
        channel === 'sms'
          ? ({ tenantId, phone: normalized } as any)
          : ({ tenantId, email: normalized } as any),
    });
    const leadIds = leads.map((lead) => lead.id);
    if (leadIds.length) {
      await this.consentRepo.update(
        { tenantId, leadId: In(leadIds), channel } as any,
        { status: 'revoked', revokedAt: new Date(), revocationSource: source },
      );
      await this.messageRepo
        .createQueryBuilder()
        .update(Message)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
          errorCode: 'RECIPIENT_OPTED_OUT',
          sanitizedErrorMessage: 'Canceled after recipient opt-out',
          lockedAt: null,
          lockedBy: null,
        })
        .where('"leadId" IN (:...leadIds)', { leadIds })
        .andWhere('direction = :direction', { direction: 'outbound' })
        .andWhere('status IN (:...statuses)', {
          statuses: ['created', 'queued', 'pending', 'scheduled'],
        })
        .execute();
    }

    return saved;
  }

  createUnsubscribeToken(tenantId: string, leadId: string, email: string) {
    const secret = this.unsubscribeSecret();
    const payload = Buffer.from(
      JSON.stringify({ tenantId, leadId, email: normalizeEmail(email), exp: Date.now() + 30 * 86_400_000 }),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  async unsubscribeEmail(token: string) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) throw new BadRequestException('Invalid unsubscribe link');
    const expected = createHmac('sha256', this.unsubscribeSecret()).update(payload).digest('base64url');
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('Invalid unsubscribe link');
    }
    let decoded: { tenantId: string; leadId: string; email: string; exp: number };
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid unsubscribe link');
    }
    if (!decoded.tenantId || !decoded.leadId || !decoded.email || decoded.exp < Date.now()) {
      throw new BadRequestException('Unsubscribe link has expired');
    }
    const lead = await this.leadRepo.findOne({
      where: { id: decoded.leadId, tenantId: decoded.tenantId },
    });
    if (!lead || normalizeEmail(lead.email || '') !== normalizeEmail(decoded.email)) {
      throw new BadRequestException('Invalid unsubscribe link');
    }
    await this.addOptOut(decoded.tenantId, 'email', decoded.email, 'unsubscribe_link', 'email_link');
    return { ok: true, message: 'You have been unsubscribed from email messages.' };
  }

  private unsubscribeSecret() {
    const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not configured');
    return secret;
  }

  async isOptedOut(tenantId: string, channel: 'sms' | 'email', value: string) {
    const normalized = channel === 'sms' ? normalizePhone(value) : normalizeEmail(value);
    const found = await this.optRepo.findOne({
      where: { tenantId, channel, value: normalized } as any,
    });
    return !!found;
  }

  async upsertQuietHours(tenantId: string, payload: any) {
    const existing = await this.qhRepo.findOne({ where: { tenantId } as any });

    const row = this.qhRepo.create({
      id: existing?.id,
      tenantId,
      enabled: payload.enabled ?? existing?.enabled ?? false,
      startMinute: payload.startMinute ?? existing?.startMinute ?? 0,
      endMinute: payload.endMinute ?? existing?.endMinute ?? 0,
      timezone: payload.timezone ?? existing?.timezone ?? 'America/New_York',
    });

    const saved = await this.qhRepo.save(row);
    let settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings) settings = this.settingsRepo.create({ tenantId });
    settings.quietHoursStart = formatHHMM(saved.startMinute);
    settings.quietHoursEnd = formatHHMM(saved.endMinute);
    settings.timeZone = saved.timezone;
    await this.settingsRepo.save(settings);
    return saved;
  }

  async findQuietHours(tenantId: string) {
    return this.qhRepo.findOne({ where: { tenantId } as any });
  }

  async getQuietHours(tenantId: string) {
    const existing = await this.findQuietHours(tenantId);
    if (existing) return existing;
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    const start = parseHHMM(settings?.quietHoursStart);
    const end = parseHHMM(settings?.quietHoursEnd);
    return this.qhRepo.create({
      tenantId,
      enabled: !!start && !!end,
      startMinute: start ? start.hour * 60 + start.minute : 0,
      endMinute: end ? end.hour * 60 + end.minute : 0,
      timezone: settings?.timeZone || 'America/New_York',
    });
  }

  async isInQuietHours(tenantId: string) {
    const qh = await this.getQuietHours(tenantId);
    if (!qh.enabled) return false;

    return isWithinQuietHours({
      now: new Date(),
      timeZone: qh.timezone,
      quietStart: formatHHMM(qh.startMinute),
      quietEnd: formatHHMM(qh.endMinute),
    });
  }

  isStopKeyword(body: string) {
    return isOptOutMessage(body);
  }
}
