import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TenantMessagingResource } from './tenant-messaging-resource.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { PlatformCredential } from './platform-credential.entity';
import { Credential } from "../settings/credential.entity";
import * as crypto from "crypto";
import { normalizePhoneE164 } from "../../common/phone";
import { OperationsService } from "../operations/operations.service";
import { operationalEvent } from "../../common/operational-log";
import { NotificationsService } from "../notifications/notifications.service";

export type IntegrationProvider = "twilio" | "sendgrid";
export type IntegrationStatus =
  | "disconnected"
  | "configured"
  | "connected"
  | "error";

export interface IntegrationSummary {
  provider: IntegrationProvider;
  connected: boolean;
  status: IntegrationStatus;
  lastSync: string | null;
  error: string | null;
  display?: Record<string, any>;
}

function isV1Encrypted(v: string) {
  return typeof v === "string" && v.startsWith("v1:");
}

function getEncKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_ENCRYPTION_KEY || "";
  if (!b64.trim()) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEY is missing in backend/.env");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)",
    );
  }
  return key;
}

function encryptJson(obj: any): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptIntegrationPayload(
  value: string | null | undefined,
): any {
  if (!value) return null;

  // Backward compatible: older rows stored plain JSON
  if (!isV1Encrypted(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  try {
    const parts = value.split(":");
    if (parts.length !== 4) return null;

    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");

    const key = getEncKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function mask(value: string | null | undefined, keepEnd = 4) {
  if (!value) return null;
  const v = String(value);
  if (v.length <= keepEnd) return v;
  return `${"*".repeat(Math.max(0, v.length - keepEnd))}${v.slice(-keepEnd)}`;
}

function isUniqueViolation(error: unknown) {
  return String((error as { code?: string })?.code || "") === "23505";
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
    private readonly operations: OperationsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional()
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources?: Repository<TenantMessagingResource>,
    @Optional()
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities?: Repository<TenantEmailIdentity>,
    @Optional()
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials?: Repository<PlatformCredential>,
  ) {}

  private async getRow(
    tenantId: string,
    provider: IntegrationProvider,
  ): Promise<Credential | null> {
    return (
      (await this.credentialsRepo.findOne({
        where: { tenant: { id: tenantId } as any, provider },
        relations: ["tenant"],
      })) || null
    );
  }

  private async getPayload(
    tenantId: string,
    provider: IntegrationProvider,
  ): Promise<any | null> {
    const row = await this.getRow(tenantId, provider);
    if (!row) return null;
    return decryptIntegrationPayload(row.encryptedValue);
  }

  private async upsertEncrypted(
    tenantId: string,
    provider: IntegrationProvider,
    payload: any,
    routingKey?: string | null,
  ) {
    let cred = await this.getRow(tenantId, provider);

    const encryptedValue = encryptJson(payload);

    if (!cred) {
      cred = this.credentialsRepo.create({
        tenant: { id: tenantId } as any,
        provider,
        encryptedValue,
        routingKey: routingKey ?? null,
      });
    } else {
      cred.encryptedValue = encryptedValue;
      if (routingKey !== undefined) cred.routingKey = routingKey;
    }

    try {
      await this.credentialsRepo.save(cred);
    } catch (error) {
      if (provider === "twilio" && routingKey && isUniqueViolation(error)) {
        throw new BadRequestException(
          "That Twilio number is already connected to another workspace.",
        );
      }
      throw error;
    }
  }

  private async recordFailure(
    tenantId: string,
    provider: IntegrationProvider,
    error: string,
  ) {
    const existing = (await this.getPayload(tenantId, provider)) || {};
    const incidentKey = existing.incidentKey || crypto.randomUUID();
    await this.upsertEncrypted(tenantId, provider, {
      ...existing,
      connected: false,
      error,
      incidentKey,
      lastSync: nowIso(),
    });
    try {
      await this.operations.createTask({
        tenantId,
        category: "integration_test_failure",
        title: `${provider} connection needs attention`,
        description:
          `The ${provider} connection or test failed. Review the provider activity log and ` +
          `workspace connection settings. Safe error summary: ${error.slice(0, 500)}`,
        priority: "high",
        relatedEntityType: `integration:${provider}`,
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
    } catch (taskError: unknown) {
      this.logger.error(
        operationalEvent("integration_failure_task_failed", {
          tenantId,
          provider,
          error:
            taskError instanceof Error ? taskError.message : String(taskError),
        }),
      );
    }
    if (!existing.error) {
      await Promise.all([
        this.notifications?.createForPlatform({
          eventType: "integration.connection_failed",
          category: "integrations",
          severity: "warning",
          title: `${provider} connection needs attention`,
          message: "A client connection test failed. Review the connection and its operations task.",
          deduplicationKey: `integration-incident:${incidentKey}`,
          incidentKey: `integration:${tenantId}:${provider}`,
          actionUrl: "/admin/dashboard?view=activity",
          entityType: "tenant",
          entityId: tenantId,
        }),
        this.notifications?.createForTenant({
          tenantId,
          eventType: "integration.connection_failed",
          category: "integrations",
          severity: "warning",
          title: "A connection needs attention",
          message: "Open Integrations to reconnect or test the account.",
          deduplicationKey: `integration-incident:${incidentKey}`,
          incidentKey: `integration:${tenantId}:${provider}`,
          actionUrl: "/app/integrations",
          entityType: "tenant",
          entityId: tenantId,
        }),
      ]);
    }
  }

  private async recordRecovery(
    tenantId: string,
    provider: IntegrationProvider,
    previous: any,
  ) {
    if (!previous?.error) return;
    const recoveryKey = `integration-recovery:${previous.incidentKey || crypto.randomUUID()}`;
    await Promise.all([
      this.notifications?.createForPlatform({
        eventType: "integration.connection_recovered",
        category: "integrations",
        severity: "success",
        title: `${provider} connection recovered`,
        message: "The client connection test is passing again.",
        deduplicationKey: recoveryKey,
        incidentKey: `integration:${tenantId}:${provider}`,
        actionUrl: "/admin/dashboard?view=activity",
        entityType: "tenant",
        entityId: tenantId,
      }),
      this.notifications?.createForTenant({
        tenantId,
        eventType: "integration.connection_recovered",
        category: "integrations",
        severity: "success",
        title: "Connection restored",
        message: "The connection test is passing again.",
        deduplicationKey: recoveryKey,
        incidentKey: `integration:${tenantId}:${provider}`,
        actionUrl: "/app/integrations",
        entityType: "tenant",
        entityId: tenantId,
      }),
    ]);
  }

  async list(tenantId: string): Promise<IntegrationSummary[]> {
    const [creds, managedTwilio, managedEmail, platformEmail] = await Promise.all([
      this.credentialsRepo.find({
        where: { tenant: { id: tenantId } as any },
        relations: ["tenant"],
      }),
      this.messagingResources?.findOne({ where: { tenantId } }) ||
        Promise.resolve(null),
      this.emailIdentities?.findOne({ where: { tenantId } }) ||
        Promise.resolve(null),
      this.platformCredentials?.findOne({ where: { provider: 'sendgrid' } }) || Promise.resolve(null),
    ]);
    const platformEmailPayload = platformEmail ? decryptIntegrationPayload(platformEmail.encryptedValue) : null;
    const platformEmailReady = !this.platformCredentials || Boolean(platformEmailPayload?.apiKey && platformEmailPayload.connected && !platformEmailPayload.error);

    const byProvider = new Map<string, Credential>();
    for (const c of creds) byProvider.set(c.provider, c);

    const providers: IntegrationProvider[] = [
      "twilio",
      "sendgrid",
    ];

    return providers.map((provider) => {
      if (provider === 'twilio' && managedTwilio) {
        const connected = managedTwilio.smsStatus === 'ready';
        return {
          provider,
          connected,
          status: managedTwilio.lastError
            ? 'error'
            : connected
              ? 'connected'
              : 'configured',
          lastSync: (
            managedTwilio.smsLastVerifiedAt || managedTwilio.updatedAt
          )?.toISOString?.() || null,
          error: managedTwilio.lastError,
          display: {
            fromNumber: managedTwilio.phoneNumber,
            readiness: managedTwilio.smsStatus,
            complianceStatus: managedTwilio.a2pComplianceStatus,
          },
        } as IntegrationSummary;
      }
      if (provider === 'sendgrid' && managedEmail) {
        const connected = platformEmailReady && managedEmail.emailStatus === 'ready' && !managedEmail.lastError && !['blocked', 'paused'].includes(managedEmail.reputationStatus);
        const error = managedEmail.lastError || (!platformEmailReady ? 'The email connection needs attention from RealtyTechAI support.' : null);
        return {
          provider,
          connected,
          status: error
            ? 'error'
            : connected
              ? 'connected'
              : 'configured',
          lastSync: (
            managedEmail.lastVerifiedAt || managedEmail.updatedAt
          )?.toISOString?.() || null,
          error,
          display: {
            fromEmail: managedEmail.fromEmail,
            fromName: managedEmail.fromName,
            readiness: managedEmail.emailStatus,
            reputationStatus: managedEmail.reputationStatus,
          },
        } as IntegrationSummary;
      }
      const row = byProvider.get(provider);
      const parsed = row ? decryptIntegrationPayload(row.encryptedValue) : null;
      const connected = Boolean(parsed && parsed.connected);
      const configured = Boolean(parsed && parsed.configured);

      // Return safe display metadata only (never secrets)
      let display: Record<string, any> = {};
      if (provider === "twilio") {
        display = {
          fromNumber: parsed?.fromNumber || null,
          accountSid: parsed?.accountSid ? mask(parsed.accountSid, 6) : null,
          webhookUrl:
            String(process.env.TWILIO_WEBHOOK_URL || "").trim() || null,
        };
      } else if (provider === "sendgrid") {
        display = {
          fromEmail: parsed?.fromEmail || null,
          inboundAddress: parsed?.inboundAddress || null,
          apiKey: parsed?.apiKey
            ? `${String(parsed.apiKey).slice(0, 6)}...`
            : null,
          inboundWebhookUrl:
            String(process.env.SENDGRID_INBOUND_WEBHOOK_URL || "").trim() ||
            null,
        };
      }

      const status: IntegrationStatus = parsed?.error
        ? "error"
        : connected
          ? "connected"
          : configured
            ? "configured"
            : "disconnected";

      return {
        provider,
        connected,
        status,
        lastSync: parsed?.lastSync || null,
        error: parsed?.error || null,
        display,
      };
    });
  }

  async connectTwilio(
    tenantId: string,
    dto: { accountSid: string; authToken: string; fromNumber: string },
  ) {
    const accountSid = dto.accountSid?.trim();
    const authToken = dto.authToken?.trim();
    const fromNumber = normalizePhoneE164(dto.fromNumber);

    if (!accountSid || !authToken || !fromNumber) {
      throw new BadRequestException("Missing Twilio credentials");
    }

    await this.upsertEncrypted(
      tenantId,
      "twilio",
      {
        connected: false,
        configured: true,
        accountSid,
        authToken,
        fromNumber,
        lastSync: nowIso(),
        error: null,
      },
      fromNumber,
    );

    return { ok: true };
  }

  async testTwilio(
    tenantId: string,
    dto: { toNumber?: string; message?: string },
  ) {
    const payload = await this.getPayload(tenantId, "twilio");
    if (!payload?.configured && !payload?.connected) {
      throw new BadRequestException("Twilio credentials have not been saved");
    }

    const accountSid = String(payload.accountSid || "").trim();
    const authToken = String(payload.authToken || "").trim();
    const fromNumber = String(payload.fromNumber || "").trim();

    if (!accountSid || !authToken || !fromNumber) {
      throw new BadRequestException("Twilio credentials are missing");
    }

    try {
      // Basic credential validation: fetch account details
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
      );

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const msg = `Twilio test failed (${r.status}): ${t || "Unauthorized or invalid credentials"}`;
        await this.recordFailure(tenantId, "twilio", msg);
        return { ok: false, error: msg };
      }

      // Optional: send a test SMS (only if toNumber provided)
      const toNumber = dto.toNumber?.trim();
      if (toNumber) {
        const body = dto.message?.trim() || "RealtyTechAI test message";
        const form = new URLSearchParams();
        form.set("From", fromNumber);
        form.set("To", toNumber);
        form.set("Body", body);

        const s = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          },
        );

        if (!s.ok) {
          const st = await s.text().catch(() => "");
          const msg = `Twilio send failed (${s.status}): ${st || "Could not send test message"}`;
          await this.recordFailure(tenantId, "twilio", msg);
          return { ok: false, error: msg };
        }
      }

      await this.upsertEncrypted(tenantId, "twilio", {
        ...payload,
        configured: true,
        connected: true,
        error: null,
        incidentKey: null,
        lastSync: nowIso(),
      });
      await this.recordRecovery(tenantId, "twilio", payload);

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Twilio test failed";
      await this.recordFailure(tenantId, "twilio", msg);
      return { ok: false, error: msg };
    }
  }

  async connectSendGrid(
    tenantId: string,
    dto: { apiKey: string; fromEmail?: string; inboundAddress?: string },
  ) {
    const apiKey = dto.apiKey?.trim();
    const fromEmail = dto.fromEmail?.trim() || null;
    const inboundAddress = String(dto.inboundAddress || "")
      .trim()
      .toLowerCase();

    if (!apiKey) {
      throw new BadRequestException("Missing SendGrid API key");
    }
    if (
      inboundAddress &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inboundAddress)
    ) {
      throw new BadRequestException("SendGrid inbound address is invalid");
    }

    await this.upsertEncrypted(
      tenantId,
      "sendgrid",
      {
        connected: false,
        configured: true,
        apiKey,
        fromEmail,
        inboundAddress: inboundAddress || null,
        lastSync: nowIso(),
        error: null,
      },
      inboundAddress || null,
    );

    return { ok: true };
  }

  async testSendGrid(tenantId: string, dto: { toEmail?: string }) {
    const payload = await this.getPayload(tenantId, "sendgrid");
    if (!payload?.configured && !payload?.connected) {
      throw new BadRequestException("SendGrid credentials have not been saved");
    }

    const apiKey = String(payload.apiKey || "").trim();
    const fromEmail = String(payload.fromEmail || "").trim();

    if (!apiKey) throw new BadRequestException("SendGrid API key missing");

    try {
      // Basic validation: fetch profile
      const r = await fetch("https://api.sendgrid.com/v3/user/profile", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const msg = `SendGrid test failed (${r.status}): ${t || "Unauthorized or invalid key"}`;
        await this.recordFailure(tenantId, "sendgrid", msg);
        return { ok: false, error: msg };
      }

      // Optional: send a test email (only if toEmail and fromEmail exist)
      const toEmail = dto.toEmail?.trim();
      if (toEmail && fromEmail) {
        const send = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail }] }],
            from: { email: fromEmail },
            subject: "RealtyTechAI test email",
            content: [
              {
                type: "text/plain",
                value: "Your SendGrid connection is working.",
              },
            ],
          }),
        });

        if (!send.ok) {
          const st = await send.text().catch(() => "");
          const msg = `SendGrid send failed (${send.status}): ${st || "Could not send test email"}`;
          await this.recordFailure(tenantId, "sendgrid", msg);
          return { ok: false, error: msg };
        }
      }

      await this.upsertEncrypted(tenantId, "sendgrid", {
        ...payload,
        configured: true,
        connected: true,
        error: null,
        incidentKey: null,
        lastSync: nowIso(),
      });
      await this.recordRecovery(tenantId, "sendgrid", payload);

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "SendGrid test failed";
      await this.recordFailure(tenantId, "sendgrid", msg);
      return { ok: false, error: msg };
    }
  }

  // Manual connect kept (for advanced users)
  async disconnect(tenantId: string, provider: IntegrationProvider) {
    await this.upsertEncrypted(
      tenantId,
      provider,
      {
        connected: false,
        configured: false,
        lastSync: null,
        error: null,
      },
      provider === "twilio"
        ? null
        : undefined,
    );

    return { ok: true };
  }
}
