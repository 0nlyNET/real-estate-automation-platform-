import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { TenantMessagingResource } from './tenant-messaging-resource.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { Credential } from "../settings/credential.entity";
import * as crypto from "crypto";
import { normalizePhoneE164 } from "../../common/phone";
import { OperationsService } from "../operations/operations.service";
import { operationalEvent } from "../../common/operational-log";
import { NotificationsService } from "../notifications/notifications.service";
import { CalendarOAuthState } from '../calendar/calendar-oauth-state.entity';

export type IntegrationProvider = "twilio" | "sendgrid" | "facebook_lead_ads";
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

function facebookGraphBase() {
  const version = String(
    process.env.FACEBOOK_GRAPH_API_VERSION || "v19.0",
  ).trim();
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new BadRequestException("FACEBOOK_GRAPH_API_VERSION is invalid");
  }
  return `https://graph.facebook.com/${version}`;
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
    @InjectRepository(CalendarOAuthState)
    private readonly oauthStates?: Repository<CalendarOAuthState>,
    @Optional() private readonly dataSource?: DataSource,
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
    const [creds, managedTwilio, managedEmail] = await Promise.all([
      this.credentialsRepo.find({
        where: { tenant: { id: tenantId } as any },
        relations: ["tenant"],
      }),
      this.messagingResources?.findOne({ where: { tenantId } }) ||
        Promise.resolve(null),
      this.emailIdentities?.findOne({ where: { tenantId } }) ||
        Promise.resolve(null),
    ]);

    const byProvider = new Map<string, Credential>();
    for (const c of creds) byProvider.set(c.provider, c);

    const providers: IntegrationProvider[] = [
      "twilio",
      "sendgrid",
      "facebook_lead_ads",
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
        const connected = managedEmail.emailStatus === 'ready';
        return {
          provider,
          connected,
          status: managedEmail.lastError
            ? 'error'
            : connected
              ? 'connected'
              : 'configured',
          lastSync: (
            managedEmail.lastVerifiedAt || managedEmail.updatedAt
          )?.toISOString?.() || null,
          error: managedEmail.lastError,
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
      } else if (provider === "facebook_lead_ads") {
        display = {
          pageId: parsed?.pageId || null,
          pageName: parsed?.pageName || null,
          lastSync: parsed?.lastSync || null,
          webhookUrl:
            String(process.env.FACEBOOK_WEBHOOK_URL || "").trim() || null,
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
  async connectFacebookLeadAdsManual(
    tenantId: string,
    dto: { pageId: string; accessToken: string; verifyToken?: string },
  ) {
    const pageId = dto.pageId?.trim();
    const accessToken = dto.accessToken?.trim();
    const verifyToken =
      dto.verifyToken?.trim() || crypto.randomBytes(16).toString("hex");

    if (!pageId || !accessToken) {
      throw new BadRequestException("Missing Facebook Lead Ads credentials");
    }

    const previous = await this.getPayload(tenantId, "facebook_lead_ads");
    await this.upsertEncrypted(tenantId, "facebook_lead_ads", {
      connected: true,
      pageId,
      accessToken,
      verifyToken,
      lastSync: nowIso(),
      error: null,
      incidentKey: null,
    });
    await this.recordRecovery(tenantId, "facebook_lead_ads", previous);

    return { ok: true, verifyToken };
  }

  // OAuth start: returns URL for frontend to redirect the user to Facebook consent screen
  async facebookOAuthStart(tenantId: string, userId: string) {
    const appId = (process.env.FACEBOOK_APP_ID || "").trim();
    const redirectUrl = (process.env.FACEBOOK_REDIRECT_URL || "").trim();

    if (!appId || !redirectUrl) {
      throw new BadRequestException(
        "Facebook OAuth is not configured (FACEBOOK_APP_ID / FACEBOOK_REDIRECT_URL)",
      );
    }

    if (!tenantId || !userId || !this.oauthStates) {
      throw new BadRequestException('Facebook OAuth state storage is unavailable');
    }
    const state = crypto.randomBytes(32).toString('base64url');
    await this.oauthStates.save(
      this.oauthStates.create({
        stateHash: crypto.createHash('sha256').update(state).digest('hex'),
        tenantId,
        userId,
        provider: 'facebook',
        // The shared OAuth-state table also carries PKCE verifiers for calendar
        // providers. Facebook state needs no verifier, but the encrypted marker
        // preserves the table's non-null and at-rest-protection contract.
        codeVerifierEncrypted: encryptJson({ provider: 'facebook' }),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        consumedAt: null,
      }),
    );

    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      "leads_retrieval",
      "pages_manage_metadata",
    ].join(",");

    const version = String(
      process.env.FACEBOOK_GRAPH_API_VERSION || "v19.0",
    ).trim();
    if (!/^v\d+\.\d+$/.test(version)) {
      throw new BadRequestException("FACEBOOK_GRAPH_API_VERSION is invalid");
    }
    const url =
      `https://www.facebook.com/${version}/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}`;

    return { url };
  }

  // OAuth callback: exchange code -> token, store token. Page selection is next step.
  async facebookOAuthCallback(
    code: string,
    state: string,
  ): Promise<{ ok: boolean; error?: string }> {
    let tenantId: string | null = null;
    try {
      const appId = (process.env.FACEBOOK_APP_ID || "").trim();
      const appSecret = (process.env.FACEBOOK_APP_SECRET || "").trim();
      const redirectUrl = (process.env.FACEBOOK_REDIRECT_URL || "").trim();

      if (!appId || !appSecret || !redirectUrl) {
        return {
          ok: false,
          error:
            "Facebook OAuth not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / FACEBOOK_REDIRECT_URL)",
        };
      }

      if (!code || !state) {
        return { ok: false, error: "Invalid Facebook callback payload" };
      }
      const claimedState = await this.consumeFacebookOAuthState(state);
      if (!claimedState) {
        return {
          ok: false,
          error: "Facebook state mismatch. Please retry connect.",
        };
      }
      tenantId = claimedState.tenantId;
      const existing = await this.getPayload(tenantId, "facebook_lead_ads");

      const tokenUrl = `${facebookGraphBase()}/oauth/access_token`;
      const tokenBody = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUrl,
        client_secret: appSecret,
        code,
      });
      // Keep the app secret out of URLs, access logs, redirects, and exception
      // strings. Reject redirects so provider responses cannot turn the token
      // exchange into a credential-forwarding request.
      const r = await fetch(tokenUrl, {
        method: "POST",
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const msg = t || `Facebook token exchange failed (${r.status})`;
        await this.recordFailure(tenantId, "facebook_lead_ads", msg);
        return { ok: false, error: msg };
      }

      const data: any = await r.json().catch(() => ({}));
      const accessToken = data?.access_token ? String(data.access_token) : null;

      if (!accessToken) {
        const msg = "Facebook token exchange returned no access_token";
        await this.recordFailure(tenantId, "facebook_lead_ads", msg);
        return { ok: false, error: msg };
      }

      // OAuth only authorizes access. A Page must still be selected and
      // subscribed before lead delivery is considered connected.
      await this.upsertEncrypted(tenantId, "facebook_lead_ads", {
        connected: false,
        configured: true,
        pageId: null,
        userAccessToken: accessToken,
        verifyToken:
          existing?.verifyToken || crypto.randomBytes(16).toString("hex"),
        lastSync: nowIso(),
        error: null,
      });

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message
        ? String(e.message)
        : "Facebook token exchange failed";
      if (tenantId)
        await this.recordFailure(tenantId, "facebook_lead_ads", msg);
      return { ok: false, error: msg };
    }
  }

  private async consumeFacebookOAuthState(rawState: string) {
    if (!this.dataSource) return null;
    const stateHash = crypto
      .createHash('sha256')
      .update(String(rawState || ''))
      .digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CalendarOAuthState);
      const row = await repository
        .createQueryBuilder('state')
        .setLock('pessimistic_write')
        .where(
          'state.stateHash = :stateHash AND state.provider = :provider',
          { stateHash, provider: 'facebook' },
        )
        .getOne();
      if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      row.consumedAt = new Date();
      await repository.save(row);
      return row;
    });
  }

  async listFacebookPages(tenantId: string) {
    const existing = await this.getPayload(tenantId, "facebook_lead_ads");
    const userAccessToken = String(existing?.userAccessToken || "").trim();
    if (!userAccessToken) {
      throw new BadRequestException(
        "Authorize Facebook before selecting a Page",
      );
    }

    const url = new URL(`${facebookGraphBase()}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token,tasks");
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        `Facebook Page lookup failed (${response.status})`;
      await this.recordFailure(tenantId, "facebook_lead_ads", message);
      throw new BadRequestException(message);
    }

    return {
      pages: Array.isArray(payload?.data)
        ? payload.data.map((page: any) => ({
            id: String(page.id),
            name: String(page.name || page.id),
          }))
        : [],
    };
  }

  async selectFacebookPage(tenantId: string, selectedPageId: string) {
    const pageId = String(selectedPageId || "").trim();
    const existing = await this.getPayload(tenantId, "facebook_lead_ads");
    const userAccessToken = String(existing?.userAccessToken || "").trim();
    if (!pageId || !userAccessToken) {
      throw new BadRequestException("Authorize Facebook and select a Page");
    }

    const pages = await this.fetchFacebookPages(userAccessToken);
    const page = pages.find(
      (candidate: any) => String(candidate.id) === pageId,
    );
    if (!page?.access_token) {
      throw new BadRequestException(
        "Selected Page is not available to this Facebook account",
      );
    }

    const subscribeUrl = new URL(
      `${facebookGraphBase()}/${encodeURIComponent(pageId)}/subscribed_apps`,
    );
    subscribeUrl.searchParams.set("subscribed_fields", "leadgen");
    const subscribed = await fetch(subscribeUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${String(page.access_token)}` },
    });
    const subscription: any = await subscribed.json().catch(() => ({}));
    if (!subscribed.ok || subscription?.success !== true) {
      const message =
        subscription?.error?.message ||
        `Facebook Page subscription failed (${subscribed.status})`;
      await this.recordFailure(tenantId, "facebook_lead_ads", message);
      throw new BadRequestException(message);
    }

    await this.upsertEncrypted(
      tenantId,
      "facebook_lead_ads",
      {
        ...existing,
        configured: true,
        connected: true,
        pageId,
        pageName: String(page.name || pageId),
        pageAccessToken: String(page.access_token),
        error: null,
        lastSync: nowIso(),
      },
      pageId,
    );

    return {
      ok: true,
      page: { id: pageId, name: String(page.name || pageId) },
    };
  }

  private async fetchFacebookPages(userAccessToken: string): Promise<any[]> {
    const url = new URL(`${facebookGraphBase()}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token,tasks");
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadRequestException(
        payload?.error?.message ||
          `Facebook Page lookup failed (${response.status})`,
      );
    }
    return Array.isArray(payload?.data) ? payload.data : [];
  }

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
      provider === "twilio" || provider === "facebook_lead_ads"
        ? null
        : undefined,
    );

    return { ok: true };
  }
}
