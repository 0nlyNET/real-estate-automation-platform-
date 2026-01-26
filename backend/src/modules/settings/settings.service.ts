import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TenantSettings } from "./tenant-settings.entity";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepo: Repository<TenantSettings>,
  ) {}

  private async findByTenantId(tenantId: string) {
    // Works whether TenantSettings has tenantId column OR tenant relation.
    return this.tenantSettingsRepo
      .createQueryBuilder("s")
      .leftJoin("s.tenant", "t")
      .where("t.id = :tenantId", { tenantId })
      .getOne();
  }

  async getTenantSettings(tenantId: string) {
    let settings = await this.findByTenantId(tenantId);

    if (!settings) {
      // Create with only fields that are almost always present.
      // We avoid null assignments to satisfy strict TS types.
      settings = this.tenantSettingsRepo.create() as TenantSettings;

      // Attach tenant relation without needing Tenant repository:
      // TypeORM allows partial relation objects.
      (settings as any).tenant = { id: tenantId };

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

    return this.tenantSettingsRepo.save(current);
  }
}
