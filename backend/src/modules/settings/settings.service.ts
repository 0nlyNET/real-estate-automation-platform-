import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as crypto from "crypto";
import { TenantSettings } from "./tenant-settings.entity";
import { Team } from "../teams/team.entity";
import { TenantQuietHours } from "../compliance/tenant-quiet-hours.entity";
import { parseHHMM } from "../../common/time";
import { EntitlementService } from "../entitlements/entitlement.service";
import { isSafeBookingUrl } from "../../common/booking-link";

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepo: Repository<TenantSettings>,
    @InjectRepository(Team) private readonly teamsRepo: Repository<Team>,
    @InjectRepository(TenantQuietHours)
    private readonly quietHoursRepo: Repository<TenantQuietHours>,
    private readonly entitlements: EntitlementService,
  ) {}

  private async findByTenantId(tenantId: string) {
    return this.tenantSettingsRepo.findOne({ where: { tenantId } });
  }

  private async getTenantSettingsEntity(tenantId: string) {
    let settings = await this.findByTenantId(tenantId);

    if (!settings) {
      // Create with only fields that are almost always present.
      // We avoid null assignments to satisfy strict TS types.
      settings = this.tenantSettingsRepo.create() as TenantSettings;

      settings.tenantId = tenantId;

      // Set safe defaults ONLY if those properties exist on the entity.
      if ("timeZone" in settings)
        (settings as any).timeZone = "America/New_York";
      if ("quietHoursStart" in settings)
        (settings as any).quietHoursStart = "21:00";
      if ("quietHoursEnd" in settings)
        (settings as any).quietHoursEnd = "08:00";
      if ("automationsEnabled" in settings)
        (settings as any).automationsEnabled = false;

      // bookingLink: do not set to null. If it exists, set to empty string.
      if ("bookingLink" in settings && (settings as any).bookingLink == null) {
        (settings as any).bookingLink = "";
      }

      await this.tenantSettingsRepo.save(settings);
    }

    return settings;
  }

  private safeSettings(settings: TenantSettings) {
    return {
      id: settings.id,
      tenantId: settings.tenantId,
      timeZone: settings.timeZone,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      bookingLink: settings.bookingLink || "",
      bookingLinkVerifiedAt: settings.bookingLinkVerifiedAt || null,
      bookingLinkStatus: !settings.bookingLink ? "missing" : settings.bookingLinkVerifiedAt ? "verified" : "test_required",
      automationsEnabled: settings.automationsEnabled,
      roundRobinEnabled: settings.roundRobinEnabled,
      roundRobinTeamId: settings.roundRobinTeamId || null,
      leadSource: settings.leadSource || null,
      leadSourceOtherLabel: settings.leadSourceOtherLabel || null,
      intake: {
        configured: Boolean(settings.intakeApiKeyHash),
        tested: Boolean(settings.intakeLastReceivedAt),
        status: !settings.intakeApiKeyHash ? "not_connected" : settings.intakeLastReceivedAt ? "connected" : "awaiting_test",
        last4: settings.intakeApiKeyLast4 || null,
        rotatedAt: settings.intakeApiKeyRotatedAt || null,
        lastReceivedAt: settings.intakeLastReceivedAt || null,
        endpointPath: `/leads/intake/${settings.tenantId}`,
      },
    };
  }

  async getTenantSettings(tenantId: string) {
    return this.safeSettings(await this.getTenantSettingsEntity(tenantId));
  }

  async rotateIntakeKey(tenantId: string) {
    const settings = await this.getTenantSettingsEntity(tenantId);
    const key = `rta_live_${crypto.randomBytes(32).toString("base64url")}`;
    settings.intakeApiKeyHash = hashIntakeKey(key);
    settings.intakeApiKeyLast4 = key.slice(-4);
    settings.intakeApiKeyRotatedAt = new Date();
    settings.intakeLastReceivedAt = null;
    const saved = await this.tenantSettingsRepo.save(settings);

    return {
      key,
      last4: saved.intakeApiKeyLast4,
      rotatedAt: saved.intakeApiKeyRotatedAt,
      endpointPath: `/leads/intake/${tenantId}`,
    };
  }

  async markIntakeReceived(tenantId: string) {
    const settings = await this.getTenantSettingsEntity(tenantId);
    settings.intakeLastReceivedAt = new Date();
    await this.tenantSettingsRepo.save(settings);
  }

  async verifyBookingLink(tenantId: string) {
    const settings = await this.getTenantSettingsEntity(tenantId);
    const link = String(settings.bookingLink || '').trim();
    if (!isSafeBookingUrl(link)) throw new BadRequestException('Save a full HTTPS booking link before confirming it');
    settings.bookingLink = link;
    settings.bookingLinkVerifiedAt = new Date();
    return this.safeSettings(await this.tenantSettingsRepo.save(settings));
  }

  async validateIntakeKey(tenantId: string, key?: string | null) {
    const supplied = String(key || "").trim();
    if (!supplied) return false;

    const settings = await this.findByTenantId(tenantId);
    const expected = settings?.intakeApiKeyHash;
    if (!expected) return false;

    const actualBuffer = Buffer.from(hashIntakeKey(supplied), "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return (
      actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    );
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
    const current = await this.getTenantSettingsEntity(tenantId);

    if (updates.automationsEnabled === true) {
      await this.entitlements.assertAllowed(tenantId, "enable_automation");
    }

    if (updates.roundRobinTeamId) {
      const team = await this.teamsRepo.findOne({
        where: { id: updates.roundRobinTeamId, tenantId },
      });
      if (!team)
        throw new BadRequestException(
          "Round-robin team must belong to this tenant",
        );
    }

    if (typeof updates.timeZone === "string" && "timeZone" in current)
      (current as any).timeZone = updates.timeZone;
    if (
      typeof updates.quietHoursStart === "string" &&
      "quietHoursStart" in current
    )
      (current as any).quietHoursStart = updates.quietHoursStart;
    if (typeof updates.quietHoursEnd === "string" && "quietHoursEnd" in current)
      (current as any).quietHoursEnd = updates.quietHoursEnd;
    if (typeof updates.bookingLink === "string" && "bookingLink" in current) {
      const link = updates.bookingLink.trim();
      if (link && !isSafeBookingUrl(link)) throw new BadRequestException("Booking link must be a full HTTPS URL");
      if (link !== String(current.bookingLink || '').trim()) current.bookingLinkVerifiedAt = null;
      (current as any).bookingLink = link;
    }
    if (
      typeof updates.automationsEnabled === "boolean" &&
      "automationsEnabled" in current
    )
      (current as any).automationsEnabled = updates.automationsEnabled;

    if (
      typeof (updates as any).roundRobinEnabled === "boolean" &&
      "roundRobinEnabled" in current
    )
      (current as any).roundRobinEnabled = (updates as any).roundRobinEnabled;

    if ("roundRobinTeamId" in (updates as any) && "roundRobinTeamId" in current)
      (current as any).roundRobinTeamId = (updates as any).roundRobinTeamId;

    const saved = await this.tenantSettingsRepo.save(current);
    if (
      updates.timeZone !== undefined ||
      updates.quietHoursStart !== undefined ||
      updates.quietHoursEnd !== undefined
    ) {
      const existing = await this.quietHoursRepo.findOne({
        where: { tenantId },
      });
      const start = parseHHMM(saved.quietHoursStart);
      const end = parseHHMM(saved.quietHoursEnd);
      if (!start || !end)
        throw new BadRequestException("Quiet hours must use HH:mm format");
      await this.quietHoursRepo.save(
        this.quietHoursRepo.create({
          id: existing?.id,
          tenantId,
          enabled: existing?.enabled ?? true,
          startMinute: start.hour * 60 + start.minute,
          endMinute: end.hour * 60 + end.minute,
          timezone: saved.timeZone,
        }),
      );
    }
    return this.safeSettings(saved);
  }
}

export function hashIntakeKey(key: string) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}
