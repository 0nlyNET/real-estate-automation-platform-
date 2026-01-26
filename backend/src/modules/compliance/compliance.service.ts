import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';

function normalizePhone(v: string) {
  return (v || '').trim();
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

    return this.qhRepo.save(row);
  }

  async getQuietHours(tenantId: string) {
    const existing = await this.qhRepo.findOne({ where: { tenantId } as any });
    if (existing) return existing;

    return this.qhRepo.save(
      this.qhRepo.create({
        tenantId,
        enabled: false,
        startMinute: 0,
        endMinute: 0,
        timezone: 'America/New_York',
      }),
    );
  }

  async isInQuietHours(tenantId: string) {
    const qh = await this.getQuietHours(tenantId);
    if (!qh.enabled) return false;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();

    const start = qh.startMinute;
    const end = qh.endMinute;

    if (start === end) return false;
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
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
