import { Injectable, Logger, OnModuleInit, ForbiddenException } from "@nestjs/common";
import { UserRole, hasAtLeastRole } from "../../common/rbac";
import { DataSource, Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import * as SendgridMail from "@sendgrid/mail";
import axios from "axios";

import { Message } from "./message.entity";
import { Lead } from "../leads/lead.entity";
import { Tenant } from "../tenants/tenant.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { LeadEvent } from "../leads/lead-event.entity";
import { SequencesService } from "../sequences/sequences.service";
import { isWithinQuietHours, nextAllowedSendTime } from "../../common/time";
import { decryptSecret } from "../../common/secrets";

@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,

    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,

    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,

    @InjectRepository(TenantSettings)
    private readonly settingsRepository: Repository<TenantSettings>,

    @InjectRepository(LeadEvent)
    private readonly leadEventRepository: Repository<LeadEvent>,

    private readonly sequencesService: SequencesService,
  ) {}

  onModuleInit(): void {
    // Lightweight sender loop: delivers pending/scheduled outbound messages without Redis.
    setInterval(() => {
      this.processPendingOutbound({ limit: 25 }).catch((e) =>
        this.logger.error(`processPendingOutbound failed: ${e?.message ?? e}`),
      );
    }, 5_000);
  }

  private requireTenant(tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException("Missing tenant");
    return tenantId;
  }

  private async getProviderConfig(tenantId: string) {
    const settings = await this.settingsRepository.findOne({
      where: { tenantId } as any,
    });

    const out: {
      sendgrid?: { apiKey?: string; fromEmail?: string; fromName?: string };
      twilio?: {
        accountSid?: string;
        authToken?: string;
        fromNumber?: string;
        messagingServiceSid?: string;
      };
    } = {};

    if (settings?.sendgridApiKeyEnc || settings?.sendgridFromEmail) {
      try {
        out.sendgrid = {
          apiKey: settings.sendgridApiKeyEnc
            ? decryptSecret(settings.sendgridApiKeyEnc)
            : undefined,
          fromEmail: settings.sendgridFromEmail || undefined,
          fromName: settings.sendgridFromName || undefined,
        };
      } catch {
        // ignore invalid encryption config
      }
    }

    if (settings?.twilioAccountSid || settings?.twilioAuthTokenEnc) {
      try {
        out.twilio = {
          accountSid: settings.twilioAccountSid || undefined,
          authToken: settings.twilioAuthTokenEnc
            ? decryptSecret(settings.twilioAuthTokenEnc)
            : undefined,
          fromNumber: settings.twilioFromNumber || undefined,
          messagingServiceSid: settings.twilioMessagingServiceSid || undefined,
        };
      } catch {
        // ignore
      }
    }

    return out;
  }

  // ============================================================
  // Controller compatibility methods (fix your TS errors)
  // ============================================================

  /**
   * Used by POST /messaging/test-email
   * Your old controller expected "testEmail", but your code had "sendLeadAutoReply"
   */
  async testEmail(payload: {
    leadId?: string;
    leadEmail?: string;
    leadName?: string;
    bookingLink?: string;
    message?: string;
  }) {
    return this.sendLeadAutoReply(payload);
  }

  /**
   * Used by POST /messaging/webhooks/twilio/sms
   * Twilio posts form-encoded fields like From, Body, etc.
   */
  async handleTwilioSmsWebhook(req: any) {
    const payload = req?.body || {};
    return this.handleInboundSms(payload);
  }

  /**
   * Used by POST /messaging/webhooks/sendgrid/inbound
   * SendGrid inbound parse webhook payload differs by config, so we best-effort map it.
   */
  async handleSendgridInboundWebhook(req: any) {
    const body = req?.body || {};
    const from = body?.from || body?.From || body?.sender;
    const text =
      body?.text ||
      body?.Text ||
      body?.email ||
      body?.body ||
      body?.Body ||
      "";
    const subject = body?.subject || body?.Subject || "";

    return this.handleInboundEmail({
      from,
      text,
      subject,
    });
  }

  /**
   * Used by POST /messaging/process
   * Manual trigger for outbound processing
   */
  async process(body: any) {
    await this.processPendingOutbound({
      limit: body?.limit ? Number(body.limit) : 25,
      leadId: body?.leadId ? String(body.leadId) : undefined,
    });
    return { status: "ok" };
  }

  // ============================================================
  // Inbox API (what frontend needs)
  // ============================================================

  /**
   * GET /messaging/threads
   * Returns last message per lead (tenant scoped)
   */
  async listThreads(
    tenantIdRaw: string,
    take = 50,
    skip = 0,
    ctx?: { userId?: string; role?: UserRole; scope?: 'shared' | 'mine' },
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);

    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : true;
    const wantsMine = ctx?.scope === 'mine';

    // Latest message per lead for this tenant
    // Uses DISTINCT ON (Postgres) to grab the newest message per lead.
    const rows = await this.messageRepository
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.lead", "l")
      .where("l.tenantId = :tenantId", { tenantId })
      .andWhere(
        (!canSeeAll || wantsMine) && ctx?.userId ? "l.assignedToUserId = :uid" : "1=1",
        { uid: ctx?.userId },
      )
      .distinctOn(["l.id"])
      .orderBy("l.id", "ASC")
      .addOrderBy("m.createdAt", "DESC")
      .take(take)
      .skip(skip)
      .getMany();

    return rows.map((m) => {
      const lead = (m as any).lead as Lead | undefined;

      return {
        leadId: lead?.id || null,
        leadName: lead?.fullName || null,
        leadEmail: lead?.email || null,
        leadPhone: lead?.phone || null,
        lastMessageId: (m as any).id,
        lastMessageAt: (m as any).createdAt,
        lastMessageBody: (m as any).body || null,
        channel: (m as any).channel || null,
        direction: (m as any).direction || null,
        status: (m as any).status || null,
      };
    });
  }

  /**
   * GET /messaging/threads/:leadId
   * Returns ordered message history for that lead (tenant scoped)
   */
  async getThreadMessages(tenantIdRaw: string, leadId: string) {
    const tenantId = this.requireTenant(tenantIdRaw);

    // Verify lead belongs to tenant
    const lead = await this.leadRepository.findOne({
      where: { id: leadId, tenantId } as any,
    });
    if (!lead) throw new ForbiddenException("Lead not found");

    const msgs = await this.messageRepository
      .createQueryBuilder("m")
      .where("m.leadId = :leadId", { leadId })
      .orderBy("m.createdAt", "ASC")
      .getMany();

    return msgs.map((m: any) => ({
      id: m.id,
      leadId: m.leadId,
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      status: m.status,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
  }

  // ============================================================
  // Instant outbound responses
  // ============================================================

  /**
   * Creates + queues the initial "instant" response for a new lead.
   * - If the lead has a phone: SMS
   * - If the lead has an email: email
   * - Respects tenant quiet hours (schedules instead of sending)
   *
   * NEVER throws (intake must not 500).
   */
  async queueInstantResponses(lead: Lead): Promise<void> {
    try {
      const tenant = await this.loadTenantForLead(lead);
      if (!tenant) return;

      const bookingLink = (tenant as any).bookingLink || "https://example.com";
      const body = `Hey ${lead.fullName}, thanks for reaching out. Here’s my booking link: ${bookingLink}`;

      const now = new Date();

      const hasQuietHours =
        !!(tenant as any).timezone &&
        !!(tenant as any).quietHoursStart &&
        !!(tenant as any).quietHoursEnd;

      const inQuiet =
        hasQuietHours &&
        isWithinQuietHours({
          now,
          timeZone: (tenant as any).timezone || "America/New_York",
          quietStart: (tenant as any).quietHoursStart ?? undefined,
          quietEnd: (tenant as any).quietHoursEnd ?? undefined,
        });

      const scheduledAt = inQuiet
        ? nextAllowedSendTime({
            now,
            timeZone: (tenant as any).timezone || "America/New_York",
            quietStart: (tenant as any).quietHoursStart ?? undefined,
            quietEnd: (tenant as any).quietHoursEnd ?? undefined,
          })
        : undefined;

      // SMS
      if ((lead as any).phone) {
        const msg = await this.createMessage({
          lead,
          channel: "sms",
          direction: "outbound",
          body,
          status: scheduledAt ? "scheduled" : "pending",
          scheduledAt,
        });

        await this.logLeadEvent(lead, "message_queued", {
          channel: "sms",
          messageId: msg.id,
          scheduledAt: scheduledAt?.toISOString(),
        });
      }

      // Email
      if ((lead as any).email) {
        const msg = await this.createMessage({
          lead,
          channel: "email",
          direction: "outbound",
          body,
          status: scheduledAt ? "scheduled" : "pending",
          scheduledAt,
        });

        await this.logLeadEvent(lead, "message_queued", {
          channel: "email",
          messageId: msg.id,
          scheduledAt: scheduledAt?.toISOString(),
        });
      }

      // Attempt to send immediately if not scheduled
      await this.processPendingOutbound({
        limit: 10,
        leadId: (lead as any).id,
      });
    } catch (e: any) {
      this.logger.error(
        `queueInstantResponses failed: ${e?.message ?? e}`,
        e?.stack,
      );
      // swallow: intake must not fail
    }
  }

  /**
   * Backwards-compatible endpoint used by /messaging/test-email.
   * Sends a one-off email if SendGrid env vars exist. Otherwise no-op.
   */
  async sendLeadAutoReply(payload: {
    leadId?: string;
    leadEmail?: string;
    leadName?: string;
    bookingLink?: string;
    message?: string;
  }): Promise<{ status: "ok" }> {
    if (!payload.leadEmail) return { status: "ok" };

    const from = process.env.MAIL_FROM_EMAIL;
    const apiKey = process.env.SENDGRID_API_KEY;

    if (!from || !apiKey) {
      this.logger.warn(
        "SendGrid env vars missing: MAIL_FROM_EMAIL or SENDGRID_API_KEY",
      );
      return { status: "ok" };
    }

    const text =
      payload.message ||
      `Hey ${payload.leadName ?? "there"}, here’s my booking link: ${
        payload.bookingLink ?? ""
      }`;

    try {
      SendgridMail.setApiKey(apiKey);
      await SendgridMail.send({
        to: payload.leadEmail,
        from,
        subject: "Quick follow-up",
        text,
      });
      this.logger.log(`SendGrid test email sent to ${payload.leadEmail}`);
    } catch (e: any) {
      this.logger.error(`SendGrid test email failed: ${e?.message ?? e}`);
    }

    return { status: "ok" };
  }

  // ============================================================
  // Outbound processing
  // ============================================================

  async processPendingOutbound(opts?: { limit?: number; leadId?: string }) {
    const limit = opts?.limit ?? 25;
    const now = new Date();

    const qb = this.messageRepository
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.lead", "lead")
      .where("m.direction = :dir", { dir: "outbound" })
      .andWhere("m.status IN (:...st)", { st: ["pending", "scheduled"] })
      .orderBy("m.createdAt", "ASC")
      .take(limit);

    if (opts?.leadId) {
      qb.andWhere("lead.id = :leadId", { leadId: opts.leadId });
    }

    qb.andWhere("(m.scheduledAt IS NULL OR m.scheduledAt <= :now)", { now });

    const messages = await qb.getMany();
    for (const msg of messages) {
      await this.trySend(msg);
    }
  }

  private async trySend(msg: Message) {
    (msg as any).attemptCount = ((msg as any).attemptCount ?? 0) + 1;
    (msg as any).lastError = undefined;
    await this.messageRepository.save(msg);

    try {
      if ((msg as any).channel === "email") {
        await this.sendEmail(msg);
      } else {
        await this.sendSms(msg);
      }

      (msg as any).status = "sent";
      (msg as any).sentAt = new Date();
      await this.messageRepository.save(msg);

      // Update lead contact metrics
      try {
        const lead: any = (msg as any).lead;
        if (lead) {
          const now = new Date();
          lead.lastContactedAt = now;
          lead.lastActivityAt = now;
          if (!lead.firstContactSentAt) {
            lead.firstContactSentAt = now;
          }
          await this.leadRepository.save(lead);
        }
      } catch {}

      await this.logLeadEvent((msg as any).lead, "message_sent", {
        channel: (msg as any).channel,
        messageId: (msg as any).id,
      });
    } catch (e: any) {
      (msg as any).status = "failed";
      (msg as any).lastError = String(e?.message ?? e);
      await this.messageRepository.save(msg);

      await this.logLeadEvent((msg as any).lead, "message_failed", {
        channel: (msg as any).channel,
        messageId: (msg as any).id,
        error: (msg as any).lastError,
      });

      this.logger.error(
        `Message send failed (id=${(msg as any).id} channel=${(msg as any).channel}): ${(msg as any).lastError}`,
      );
    }
  }

  private async sendEmail(msg: Message) {
    const tenantId = (msg as any).lead?.tenantId;
    const cfg = tenantId ? await this.getProviderConfig(tenantId) : {};

    const apiKey = cfg.sendgrid?.apiKey || process.env.SENDGRID_API_KEY;
    const fromEmail =
      cfg.sendgrid?.fromEmail ||
      process.env.MAIL_FROM_EMAIL ||
      process.env.SENDGRID_FROM_EMAIL;
    const fromName =
      cfg.sendgrid?.fromName || process.env.SENDGRID_FROM_NAME || "RealtyTechAI";

    const to = (msg as any).lead?.email;
    if (!to) {
      (msg as any).status = "skipped";
      (msg as any).lastError = "Missing lead email";
      await this.messageRepository.save(msg);
      return;
    }

    if (!apiKey || !fromEmail) throw new Error("Missing SendGrid config");

    SendgridMail.setApiKey(apiKey);
    await SendgridMail.send({
      to,
      from: { email: fromEmail, name: fromName },
      subject: "Quick follow-up",
      text: (msg as any).body,
    });
  }

  private async sendSms(msg: Message) {
    const tenantId = (msg as any).lead?.tenantId;
    const cfg = tenantId ? await this.getProviderConfig(tenantId) : {};

    const sid = cfg.twilio?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const token = cfg.twilio?.authToken || process.env.TWILIO_AUTH_TOKEN;
    const from = cfg.twilio?.fromNumber || process.env.TWILIO_FROM_NUMBER;
    const messagingServiceSid = cfg.twilio?.messagingServiceSid;

    const to = (msg as any).lead?.phone;
    if (!to) {
      (msg as any).status = "skipped";
      (msg as any).lastError = "Missing lead phone";
      await this.messageRepository.save(msg);
      return;
    }

    if (!sid || !token) throw new Error("Missing Twilio config");
    if (!from && !messagingServiceSid)
      throw new Error("Missing Twilio From number or Messaging Service SID");

    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const data = new URLSearchParams({
      To: to,
      Body: (msg as any).body,
      ...(messagingServiceSid
        ? { MessagingServiceSid: messagingServiceSid }
        : { From: from as string }),
    });

    const resp = await axios.post(url, data, {
      auth: { username: sid, password: token },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    (msg as any).providerMessageId = resp.data?.sid;
  }

  private async loadTenantForLead(lead: Lead): Promise<Tenant | null> {
    if ((lead as any).tenant) return (lead as any).tenant;
    const tenantId = (lead as any).tenantId;
    if (!tenantId) return null;
    return this.tenantRepository.findOne({ where: { id: tenantId } as any });
  }

  private async logLeadEvent(
    lead: Lead,
    eventType: string,
    metadata?: Record<string, any>,
  ) {
    try {
      const ev = this.leadEventRepository.create({
        lead,
        eventType,
        metadata,
      } as any);
      await this.leadEventRepository.save(ev);
    } catch (e: any) {
      this.logger.error(`logLeadEvent failed: ${e?.message ?? e}`);
    }
  }

  // ============================================================
  // Inbound handling (reply stops follow-ups)
  // ============================================================

  /**
   * IMPORTANT:
   * - DB stores lead.phone as digits-only (e.g. "15551230003")
   * - Twilio From is usually "+15551230003"
   * So normalize inbound to digits-only before lookup.
   */
  async handleInboundSms(payload: { From?: string; Body?: string; To?: string }) {
    const rawFrom = payload?.From ?? "";
    const fromDigits = normalizePhone(rawFrom);
    if (!fromDigits) return { status: "ignored" } as const;

    const lead = await this.leadRepository.findOne({
      where: { phone: fromDigits } as any,
      relations: ["tenant"],
      order: { createdAt: "DESC" } as any,
    });

    if (!lead) {
      this.logger.log(
        `Inbound SMS: no lead match From=${rawFrom} normalized=${fromDigits}`,
      );
      return { status: "no_lead" } as const;
    }

    const inbound = await this.createMessage({
      lead,
      channel: "sms",
      direction: "inbound",
      body: payload?.Body ?? "",
      status: "received",
    });


    // Speed-to-lead: capture first response time
    if (!(lead as any).firstResponseReceivedAt) {
      const now = new Date();
      (lead as any).firstResponseReceivedAt = now;
      const firstContact = (lead as any).firstContactSentAt ? new Date((lead as any).firstContactSentAt) : null;
      if (firstContact) {
        const sec = Math.max(0, Math.floor((now.getTime() - firstContact.getTime()) / 1000));
        (lead as any).firstResponseTimeSec = sec;
      }
    }
    await this.logLeadEvent(lead, "lead_replied", {
      channel: "sms",
      messageId: inbound.id,
    });

    await this.sequencesService.stopForLead(lead.id, "reply");

    (lead as any).sequenceStatus = "stopped";
    await this.leadRepository.save(lead);

    return { status: "ok" } as const;
  }

  async handleInboundEmail(payload: {
    from?: string;
    text?: string;
    subject?: string;
  }) {
    const from = normalizeEmail(payload?.from);
    if (!from) return { status: "ignored" } as const;

    const lead = await this.leadRepository.findOne({
      where: { email: from } as any,
      relations: ["tenant"],
      order: { createdAt: "DESC" } as any,
    });

    if (!lead) return { status: "no_lead" } as const;

    const inbound = await this.createMessage({
      lead,
      channel: "email",
      direction: "inbound",
      body: payload?.text ?? "",
      status: "received",
    });


    // Speed-to-lead: capture first response time
    if (!(lead as any).firstResponseReceivedAt) {
      const now = new Date();
      (lead as any).firstResponseReceivedAt = now;
      const firstContact = (lead as any).firstContactSentAt ? new Date((lead as any).firstContactSentAt) : null;
      if (firstContact) {
        const sec = Math.max(0, Math.floor((now.getTime() - firstContact.getTime()) / 1000));
        (lead as any).firstResponseTimeSec = sec;
      }
    }
    await this.logLeadEvent(lead, "lead_replied", {
      channel: "email",
      messageId: inbound.id,
      subject: payload?.subject,
    });

    await this.sequencesService.stopForLead(lead.id, "reply");

    (lead as any).sequenceStatus = "stopped";
    await this.leadRepository.save(lead);

    return { status: "ok" } as const;
  }

  // ============================================================
  // DB helpers
  // ============================================================

  async createMessage(data: Partial<Message>) {
    const message = this.messageRepository.create(data);
    await this.messageRepository.save(message);
    this.logger.log(`Message created (id=${(message as any).id})`);
    return message;
  }

  async getMessagesForLead(leadId: string) {
    return this.messageRepository.find({
      where: { lead: { id: leadId } as any } as any,
      order: { createdAt: "DESC" } as any,
    });
  }
}

// --------------------------
// Normalizers (canonical formats)
// --------------------------

/**
 * Canonical phone format for this app: digits-only, usually 11 digits starting with 1 for US.
 * Examples:
 *  "+15551230003" -> "15551230003"
 *  "15551230003"  -> "15551230003"
 *  "5551230003"   -> "15551230003"
 */
function normalizePhone(v?: string): string | null {
  if (!v) return null;

  let digits = String(v).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 10) digits = `1${digits}`;

  return digits;
}

function normalizeEmail(v?: string): string | null {
  if (!v) return null;
  const e = String(v).trim().toLowerCase();
  if (!e.includes("@")) return null;

  // Some inbound providers send: "Name <email@x.com>"
  const m = e.match(/<([^>]+)>/);
  return (m?.[1] ?? e).trim();
}
