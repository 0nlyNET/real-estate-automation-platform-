import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isSafeBookingUrl } from "../../common/booking-link";
import { normalizePhoneE164 } from "../../common/phone";
import { isValidIanaTimeZone, isWithinQuietHours } from "../../common/time";
import { Appointment } from "../client-operations/appointment.entity";
import { ComplianceService } from "../compliance/compliance.service";
import { EntitlementService } from "../entitlements/entitlement.service";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { Tenant } from "../tenants/tenant.entity";
import { Message } from "./message.entity";

export interface MessageSafetyInput {
  leadId: string;
  clientId: string;
  jobId?: string;
  communicationType: "sms" | "email" | "sequence" | "reminder";
  requiresBookingLink: boolean;
  now?: Date;
}

export interface MessageSafetyResult {
  allowed: boolean;
  reasons: string[];
  ruleIds: string[];
}

@Injectable()
export class MessageSafetyService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private readonly settingsRepository: Repository<TenantSettings>,
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(LeadEvent)
    private readonly leadEventRepository: Repository<LeadEvent>,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
  ) {}

  async verifyMessageSafety(
    leadId: string,
    clientId: string,
  ): Promise<boolean> {
    const lead = await this.leadRepository.findOne({
      where: { id: leadId, tenantId: clientId },
    });
    const communicationType = lead?.phone ? "sms" : "email";
    const result = await this.evaluateMessageSafety({
      leadId,
      clientId,
      communicationType,
      requiresBookingLink: false,
    });
    return result.allowed;
  }

  async evaluateMessageSafety(
    input: MessageSafetyInput,
  ): Promise<MessageSafetyResult> {
    const reasons = new Map<string, string>();
    const block = (ruleId: string, reason: string) => {
      if (!reasons.has(ruleId)) reasons.set(ruleId, reason);
    };
    const now = input.now ?? new Date();
    const lead = await this.leadRepository.findOne({
      where: { id: input.leadId, tenantId: input.clientId },
    });
    const tenant = await this.tenantRepository.findOne({
      where: { id: input.clientId },
    });
    const settings = await this.settingsRepository.findOne({
      where: { tenantId: input.clientId },
    });
    const job = input.jobId
      ? await this.messageRepository
          .createQueryBuilder("message")
          .innerJoinAndSelect("message.lead", "lead")
          .where("message.id = :jobId", { jobId: input.jobId })
          .andWhere("message.leadId = :leadId", { leadId: input.leadId })
          .andWhere("lead.tenantId = :tenantId", { tenantId: input.clientId })
          .getOne()
      : null;
    const automated = !job || job.authorship !== "human";

    if (!lead)
      block("LEAD_NOT_FOUND", "Lead was not found inside the client workspace");
    if (!tenant) block("CLIENT_NOT_FOUND", "Client workspace was not found");
    if (input.jobId && !job) {
      block(
        "JOB_NOT_FOUND",
        "Communication job was not found inside the client workspace",
      );
    }

    if (lead) {
      if (lead.communicationStatus === "blocked") {
        block("LEAD_BLOCKED", "Lead communication is blocked");
      }
      if (lead.communicationStatus === "paused") {
        block("LEAD_PAUSED", "Lead communication is paused");
      }
      if (lead.communicationStatus === "opted_out" || lead.optedOutAt) {
        block(
          "LEAD_OPTED_OUT",
          "Lead has opted out of automated communication",
        );
      }
      if (lead.stage === "lost") {
        block("LEAD_LOST", "Lost leads cannot receive ordinary automation");
      }
      if (lead.stage === "closed") {
        block("LEAD_CLOSED", "Closed leads cannot receive ordinary automation");
      }

      if (automated) {
        const noShow = await this.appointmentRepository.findOne({
          where: {
            tenantId: input.clientId,
            leadId: input.leadId,
            status: "no_show",
          },
          order: { startsAt: "DESC" },
        });
        if (noShow && job?.jobPurpose !== "no_show_reschedule") {
          block(
            "NO_SHOW_NURTURE_BLOCKED",
            "No-show leads require an explicitly approved rescheduling workflow",
          );
        }
      }
    }

    if (tenant) {
      if (tenant.lifecycleStatus === "SUSPENDED") {
        block("CLIENT_SUSPENDED", "Client services are suspended");
      } else if (tenant.lifecycleStatus === "PAUSED") {
        block("CLIENT_PAUSED", "Client services are paused");
      } else if (tenant.lifecycleStatus !== "ACTIVE") {
        block(
          "CLIENT_INACTIVE",
          `Client lifecycle is ${tenant.lifecycleStatus || "not active"}`,
        );
      }
      if (
        ["canceled", "unpaid", "paused", "incomplete_expired"].includes(
          tenant.status,
        )
      ) {
        block(
          "CLIENT_ACCOUNT_INACTIVE",
          `Client account status ${tenant.status} prohibits delivery`,
        );
      }
    }

    const emailChannel = (job?.channel ?? input.communicationType) === "email";
    const action = automated
      ? emailChannel
        ? "send_automated_email"
        : "send_automated_sms"
      : emailChannel
        ? "send_manual_email"
        : "send_manual_sms";
    const entitlement = await this.entitlements.evaluate(
      input.clientId,
      action,
      now,
    );
    for (const reason of entitlement.reasons) {
      if (/globally paused/i.test(reason)) {
        block("GLOBAL_AUTOMATION_PAUSED", reason);
      } else if (/automation is disabled/i.test(reason)) {
        block("CLIENT_AUTOMATION_PAUSED", reason);
      } else if (/billing|payment|trial/i.test(reason)) {
        block("SERVICE_ENTITLEMENT_INACTIVE", reason);
      } else {
        block("SERVICE_NOT_ENTITLED", reason);
      }
    }

    if (automated) {
      const timeZone = String(settings?.timeZone || "").trim();
      if (!timeZone) {
        block("TIME_ZONE_MISSING", "Client time zone is missing");
      } else if (!isValidIanaTimeZone(timeZone)) {
        block(
          "TIME_ZONE_INVALID",
          "Client time zone is not a valid IANA time zone",
        );
      } else if (!settings?.timeZoneVerifiedAt) {
        block("TIME_ZONE_UNVERIFIED", "Client time zone has not been verified");
      } else {
        const quietHours = await this.compliance.getQuietHours(input.clientId);
        if (
          quietHours.enabled &&
          isWithinQuietHours({
            now,
            timeZone,
            quietStart: minutesToTime(quietHours.startMinute),
            quietEnd: minutesToTime(quietHours.endMinute),
          })
        ) {
          block(
            "QUIET_HOURS",
            "Automated delivery is blocked during client quiet hours",
          );
        }
      }
    }

    const requiresBookingLink =
      input.requiresBookingLink || job?.requiresBookingLink === true;
    if (requiresBookingLink) {
      const bookingLink = String(settings?.bookingLink || "").trim();
      if (!bookingLink || !isSafeBookingUrl(bookingLink)) {
        block("BOOKING_LINK_INVALID", "A valid HTTPS booking link is required");
      } else if (
        settings?.bookingLinkVerificationStatus === "failed" ||
        settings?.bookingLinkVerificationStatus === "revoked" ||
        settings?.bookingLinkRevokedAt
      ) {
        block(
          "BOOKING_LINK_REVOKED",
          "Booking-link verification failed or was revoked",
        );
      } else if (
        settings?.bookingLinkVerificationStatus !== "verified" ||
        !settings.bookingLinkVerifiedAt
      ) {
        block("BOOKING_LINK_UNVERIFIED", "Booking link has not been verified");
      } else if (
        settings.bookingLinkVerificationExpiresAt &&
        settings.bookingLinkVerificationExpiresAt <= now
      ) {
        block("BOOKING_LINK_EXPIRED", "Booking-link verification has expired");
      }
    }

    if (lead) {
      const channel = job?.channel ?? normalizeChannel(input.communicationType);
      if (channel === "sms") {
        if (!lead.smsEligible || !normalizePhoneE164(lead.phone)) {
          block(
            "SMS_DESTINATION_INELIGIBLE",
            "Lead does not have an eligible E.164 phone number",
          );
        }
      } else if (!lead.emailEligible || !isValidEmail(lead.email)) {
        block(
          "EMAIL_DESTINATION_INELIGIBLE",
          "Lead does not have an eligible email address",
        );
      }
      const consent = await this.compliance.communicationEligibility(
        input.clientId,
        lead,
        channel,
      );
      if (!consent.allowed) {
        block(
          consent.code || "CHANNEL_CONSENT_BLOCKED",
          consent.reason || "Channel consent check failed",
        );
      }
    }

    const result: MessageSafetyResult = {
      allowed: reasons.size === 0,
      reasons: [...reasons.values()],
      ruleIds: [...reasons.keys()],
    };
    if (!result.allowed && job && lead) {
      await this.persistBlockedJob(job, lead, result, now);
    }
    return result;
  }

  private async persistBlockedJob(
    job: Message,
    lead: Lead,
    result: MessageSafetyResult,
    blockedAt: Date,
  ): Promise<void> {
    const reason = result.reasons.join("; ").slice(0, 2_000);
    const currentHistory = Array.isArray(job.blockedReasonHistory)
      ? job.blockedReasonHistory
      : [];
    const duplicate = currentHistory.some(
      (entry) =>
        entry.reason === reason &&
        entry.ruleIds.join("|") === result.ruleIds.join("|"),
    );
    job.status = "blocked";
    job.errorCode = "SAFETY_GUARDRAIL";
    job.lastError = reason;
    job.sanitizedErrorMessage = reason;
    job.blockedAt = job.blockedAt || blockedAt;
    job.blockedReason = reason;
    job.safetyRuleIds = result.ruleIds;
    job.lockedAt = null;
    job.lockedBy = null;
    job.nextAttemptAt = null;
    if (!duplicate) {
      job.blockedReasonHistory = [
        ...currentHistory,
        {
          reason,
          ruleIds: result.ruleIds,
          blockedAt: blockedAt.toISOString(),
        },
      ];
    }
    await this.messageRepository.save(job);
    if (!duplicate) {
      await this.leadEventRepository.save(
        this.leadEventRepository.create({
          lead,
          eventType: "message_blocked_by_safety_guardrail",
          metadata: {
            tenantId: lead.tenantId,
            leadId: lead.id,
            jobId: job.id,
            communicationType: job.communicationType,
            ruleIds: result.ruleIds,
            blockedAt: blockedAt.toISOString(),
          },
        }),
      );
    }
  }
}

function normalizeChannel(
  communicationType: MessageSafetyInput["communicationType"],
): "sms" | "email" {
  return communicationType === "email" ? "email" : "sms";
}

function minutesToTime(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1_439, Math.trunc(totalMinutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function isValidEmail(value?: string | null): boolean {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
