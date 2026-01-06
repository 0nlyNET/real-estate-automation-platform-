import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettings } from './tenant-settings.entity';

type TenantSettingsPatch = Partial<
  Pick<
    TenantSettings,
    'timeZone' | 'quietHoursStart' | 'quietHoursEnd' | 'bookingLink' | 'automationsEnabled'
  >
>;

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepo: Repository<TenantSettings>,
  ) {}

  async getTenantSettings(tenantId: string): Promise<TenantSettings> {
    if (!tenantId) throw new BadRequestException('tenantId is required');

    const existing = await this.tenantSettingsRepo.findOne({
      where: { tenantId },
    });

    if (existing) return existing;

    const created = this.tenantSettingsRepo.create({
      tenantId,
      timeZone: process.env.DEFAULT_TIME_ZONE || 'America/New_York',
      quietHoursStart: process.env.DEFAULT_QUIET_START || '21:00',
      quietHoursEnd: process.env.DEFAULT_QUIET_END || '08:00',
      bookingLink: undefined,
      automationsEnabled:
        process.env.DEFAULT_AUTOMATIONS_ENABLED === 'false' ? false : true,
    });

    return await this.tenantSettingsRepo.save(created);
  }

  async updateTenantSettings(
    tenantId: string,
    patch: TenantSettingsPatch,
  ): Promise<TenantSettings> {
    if (!tenantId) throw new BadRequestException('tenantId is required');

    const row = await this.getTenantSettings(tenantId);

    if (patch.timeZone !== undefined) {
      row.timeZone = String(patch.timeZone).trim();
    }

    if (patch.quietHoursStart !== undefined) {
      row.quietHoursStart = String(patch.quietHoursStart).trim();
    }

    if (patch.quietHoursEnd !== undefined) {
      row.quietHoursEnd = String(patch.quietHoursEnd).trim();
    }

    if (patch.bookingLink !== undefined) {
      const v = String(patch.bookingLink || '').trim();

      if (!v) {
        row.bookingLink = undefined;
      } else {
        // basic URL sanity check
        try {
          const u = new URL(v);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            throw new Error('bad protocol');
          }
          row.bookingLink = v;
        } catch {
          throw new BadRequestException(
            'bookingLink must be a valid http(s) URL',
          );
        }
      }
    }

    if (patch.automationsEnabled !== undefined) {
      row.automationsEnabled = Boolean(patch.automationsEnabled);
    }

    return await this.tenantSettingsRepo.save(row);
  }
}