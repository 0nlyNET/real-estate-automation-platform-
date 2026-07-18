import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TenantSettings } from "./tenant-settings.entity";
import { Team } from "../teams/team.entity";
import { TenantQuietHours } from "../compliance/tenant-quiet-hours.entity";
import { parseHHMM } from "../../common/time";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepo: Repository<TenantSettings>,
    @InjectRepository(Team) private readonly teamsRepo: Repository<Team>,
    @InjectRepository(TenantQuietHours) private readonly quietHoursRepo: Repository<TenantQuietHours>,
  ) {}

  private async findByTenantId(tenantId: string) {
    return this.tenantSettingsRepo.findOne({ where: { tenantId } });
  }

  async getTenantSettings(tenantId: string) {
    let settings = await this.findByTenantId(tenantId);

    if (!settings) {
      // Create with only fields that are almost always present.
      // We avoid null assignments to satisfy strict TS types.
      settings = this.tenantSettingsRepo.create() as TenantSettings;

      settings.tenantId = tenantId;

      // Set safe defaults ONLY if those properties exist on the entity.
      if ("timeZone" in settings) (settings as any).timeZone = "America/New_York";
      if ("quietHoursStart" in settings) (settings as any).quietHoursStart = "21:00";
      if ("quietHoursEnd" in settings) (settings as any).quietHoursEnd = "08:00";
      if ("automationsEnabled" in settings) (settings as any).automationsEnabled = true;

      // bookingLink: do not set to null. If it exists, set to empty string.
      if ("bookingLink" in settings && (settings as any).bookingLink == null) {
        (settings as any).bookingLink = "";
      }

      await this.tenantSettingsRepo.save(settings);
    }

    return settings;
  }

  async updateTenantSettings(
    tenantId: string,
    updates: Partial<{
      timeZone: string;
      quietHoursStart: string;
      quietHoursEnd: string;
      bookingLink: string;
      automationsEnabled: boolean;
      roundRobinEnabled: boolean;
      roundRobinTeamId: string | null;
    }>,
  ) {
    const current = await this.getTenantSettings(tenantId);

    if (updates.roundRobinTeamId) {
      const team = await this.teamsRepo.findOne({ where: { id: updates.roundRobinTeamId, tenantId } });
      if (!team) throw new BadRequestException('Round-robin team must belong to this tenant');
    }

    if (typeof updates.timeZone === "string" && "timeZone" in current) (current as any).timeZone = updates.timeZone;
    if (typeof updates.quietHoursStart === "string" && "quietHoursStart" in current)
      (current as any).quietHoursStart = updates.quietHoursStart;
    if (typeof updates.quietHoursEnd === "string" && "quietHoursEnd" in current)
      (current as any).quietHoursEnd = updates.quietHoursEnd;
    if (typeof updates.bookingLink === "string" && "bookingLink" in current) (current as any).bookingLink = updates.bookingLink;
    if (typeof updates.automationsEnabled === "boolean" && "automationsEnabled" in current)
      (current as any).automationsEnabled = updates.automationsEnabled;

    if (typeof (updates as any).roundRobinEnabled === "boolean" && "roundRobinEnabled" in current)
      (current as any).roundRobinEnabled = (updates as any).roundRobinEnabled;

    if (("roundRobinTeamId" in (updates as any)) && "roundRobinTeamId" in current)
      (current as any).roundRobinTeamId = (updates as any).roundRobinTeamId;

    const saved = await this.tenantSettingsRepo.save(current);
    if (updates.timeZone !== undefined || updates.quietHoursStart !== undefined || updates.quietHoursEnd !== undefined) {
      const existing = await this.quietHoursRepo.findOne({ where: { tenantId } });
      const start = parseHHMM(saved.quietHoursStart);
      const end = parseHHMM(saved.quietHoursEnd);
      if (!start || !end) throw new BadRequestException('Quiet hours must use HH:mm format');
      await this.quietHoursRepo.save(this.quietHoursRepo.create({
        id: existing?.id,
        tenantId,
        enabled: existing?.enabled ?? true,
        startMinute: start.hour * 60 + start.minute,
        endMinute: end.hour * 60 + end.minute,
        timezone: saved.timeZone,
      }));
    }
    return saved;
  }
}
