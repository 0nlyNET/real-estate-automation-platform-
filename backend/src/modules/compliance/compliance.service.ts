import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { formatHHMM, isWithinQuietHours, parseHHMM } from '../../common/time';

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
  ) {}

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

    const saved = await this.optRepo.save(row).catch(async () => row);

    await this.recordEvent(tenantId, {
      type: 'opt_out_recorded',
      channel,
      to: normalized,
      payload: { reason, source },
    });

    return saved;
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
    const t = (body || '').trim().toUpperCase();
    return (
      t === 'STOP' ||
      t === 'STOPALL' ||
      t === 'UNSUBSCRIBE' ||
      t === 'CANCEL' ||
      t === 'END' ||
      t === 'QUIT'
    );
  }
}
