import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, timingSafeEqual } from "crypto";
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
} from "typeorm";
import { decryptString, encryptString } from "../../common/crypto-secrets";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { Credential } from "../settings/credential.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { Tenant } from "../tenants/tenant.entity";
import { LeadIngestionEvent } from "./lead-ingestion-event.entity";
import {
  IncomingLeadPayload,
  LeadIngestionResult,
  LeadProvider,
  ProviderLeadAdapter,
} from "./lead-ingestion.types";
import {
  asRecord,
  firstText,
  parseProviderPayload,
  sanitizedPayloadMetadata,
} from "./provider-payload";
import { RealtorLeadAdapter } from "./realtor-lead.adapter";
import { ZillowLeadAdapter } from "./zillow-lead.adapter";
import { LimitsService } from "../limits/limits.service";
import { assertLeadAcceptance } from "../leads/lead-acceptance";

type HeaderMap = Record<string, string | string[] | undefined>;

type RealtorCredentialConfig = {
  configured?: boolean;
  apiKey?: string;
};

@Injectable()
export class LeadIngestionService {
  private readonly adapters: ReadonlyMap<LeadProvider, ProviderLeadAdapter>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TenantSettings)
    private readonly settingsRepository: Repository<TenantSettings>,
    @InjectRepository(Credential)
    private readonly credentialRepository: Repository<Credential>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    zillowAdapter: ZillowLeadAdapter,
    realtorAdapter: RealtorLeadAdapter,
    @Optional() private readonly limits?: LimitsService,
  ) {
    this.adapters = new Map<LeadProvider, ProviderLeadAdapter>([
      [zillowAdapter.provider, zillowAdapter],
      [realtorAdapter.provider, realtorAdapter],
    ]);
  }

  async ingest(input: {
    body: unknown;
    headers: HeaderMap;
    correlationId: string;
  }): Promise<LeadIngestionResult> {
    const apiKey = this.extractApiKey(input.headers);
    if (!apiKey)
      throw new UnauthorizedException("Missing ingestion credential");

    const payload = parseProviderPayload(input.body);
    const provider = this.resolveProvider(payload, input.headers);
    const tenantId = await this.resolveTenant(provider, apiKey);
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new UnauthorizedException("Invalid ingestion tenant");
    assertLeadAcceptance(tenant, { source: `provider:${provider}` });
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new BadRequestException("Unsupported lead provider");

    const normalized = adapter.normalize(payload, tenantId);
    const validationError = this.contactValidationError(normalized);
    const fingerprint = this.fingerprint(normalized);
    const idempotencyKey = normalized.providerLeadId
      ? `provider:${sha256(normalized.providerLeadId)}`
      : `fingerprint:${fingerprint}`;
    const correlationId = normalizeCorrelationId(input.correlationId);
    const payloadMetadata = sanitizedPayloadMetadata(payload);

    const usage = await this.limits?.reserveUsage({
      tenantId,
      metric: "lead",
      idempotencyKey: `lead-ingestion:${tenantId}:${provider}:${idempotencyKey}`,
    });
    if (usage && !usage.ok) {
      throw new HttpException(
        { code: usage.code, message: usage.message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.dataSource.transaction((manager) =>
      this.persistIngestion(manager, {
        normalized,
        validationError,
        fingerprint,
        idempotencyKey,
        correlationId,
        payloadMetadata,
      }),
    );
    await this.markAuthenticatedProviderDelivery(provider, tenantId);
    return result;
  }

  private async markAuthenticatedProviderDelivery(
    provider: LeadProvider,
    tenantId: string,
  ) {
    if (provider !== "realtor") return;
    const credential = await this.credentialRepository.findOne({
      where: {
        provider: "realtor_com",
        tenant: { id: tenantId } as any,
      },
      relations: ["tenant"],
    });
    if (!credential?.encryptedValue) return;
    const config = asRecord(
      JSON.parse(decryptString(credential.encryptedValue)),
    );
    if (!config?.configured) return;
    credential.encryptedValue = encryptString(
      JSON.stringify({
        ...config,
        connected: true,
        lastSync: new Date().toISOString(),
        error: null,
      }),
    );
    await this.credentialRepository.save(credential);
  }

  private async persistIngestion(
    manager: EntityManager,
    input: {
      normalized: IncomingLeadPayload;
      validationError: string | null;
      fingerprint: string;
      idempotencyKey: string;
      correlationId: string;
      payloadMetadata: Record<string, unknown>;
    },
  ): Promise<LeadIngestionResult> {
    const tenant = await manager.getRepository(Tenant).findOne({
      where: { id: input.normalized.tenantId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!tenant) throw new UnauthorizedException('Invalid ingestion tenant');
    assertLeadAcceptance(tenant, {
      source: `provider:${input.normalized.provider}`,
    });
    const lockKey = [
      "lead-ingestion",
      input.normalized.tenantId,
      input.normalized.provider,
      input.idempotencyKey,
    ].join(":");
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      lockKey,
    ]);
    const contactLocks = [
      input.normalized.email
        ? `lead-dedup:${input.normalized.tenantId}:email:${input.normalized.email}`
        : null,
      input.normalized.phone
        ? `lead-dedup:${input.normalized.tenantId}:phone:${input.normalized.phone}`
        : null,
    ]
      .filter((value): value is string => Boolean(value))
      .sort();
    for (const contactLock of contactLocks) {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        contactLock,
      ]);
    }

    const eventRepository = manager.getRepository(LeadIngestionEvent);
    const duplicate = await eventRepository.findOne({
      where: {
        tenantId: input.normalized.tenantId,
        provider: input.normalized.provider,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (duplicate) {
      return {
        acknowledged: true,
        status: "duplicate",
        eventId: duplicate.id,
        leadId: duplicate.leadId ?? null,
        validationError: duplicate.validationError ?? null,
      };
    }

    const processedAt = new Date();
    if (input.validationError) {
      const rejected = await eventRepository.save(
        eventRepository.create({
          tenantId: input.normalized.tenantId,
          provider: input.normalized.provider,
          providerLeadId: input.normalized.providerLeadId,
          idempotencyKey: input.idempotencyKey,
          ingestionFingerprint: input.fingerprint,
          status: "failed_validation",
          validationError: input.validationError,
          correlationId: input.correlationId,
          payloadMetadata: input.payloadMetadata,
          leadId: null,
          providerReceivedAt: input.normalized.receivedAt,
          processedAt,
        }),
      );
      await this.markTenantIntakeReceived(
        manager,
        input.normalized.tenantId,
        processedAt,
      );
      return {
        acknowledged: true,
        status: "rejected_validation",
        eventId: rejected.id,
        leadId: null,
        validationError: input.validationError,
      };
    }

    const lead = await this.upsertLead(
      manager,
      input.normalized,
      input.fingerprint,
    );
    const accepted = await eventRepository.save(
      eventRepository.create({
        tenantId: input.normalized.tenantId,
        provider: input.normalized.provider,
        providerLeadId: input.normalized.providerLeadId,
        idempotencyKey: input.idempotencyKey,
        ingestionFingerprint: input.fingerprint,
        status: "accepted",
        validationError: null,
        correlationId: input.correlationId,
        payloadMetadata: input.payloadMetadata,
        leadId: lead.id,
        providerReceivedAt: input.normalized.receivedAt,
        processedAt,
      }),
    );
    await manager.getRepository(LeadEvent).save(
      manager.getRepository(LeadEvent).create({
        lead,
        eventType: "provider_lead_ingested",
        metadata: {
          provider: input.normalized.provider,
          providerLeadId: input.normalized.providerLeadId,
          ingestionEventId: accepted.id,
          correlationId: input.correlationId,
        },
      }),
    );
    await this.markTenantIntakeReceived(
      manager,
      input.normalized.tenantId,
      processedAt,
    );

    return {
      acknowledged: true,
      status: "accepted",
      eventId: accepted.id,
      leadId: lead.id,
      validationError: null,
    };
  }

  private async upsertLead(
    manager: EntityManager,
    payload: IncomingLeadPayload,
    fingerprint: string,
  ): Promise<Lead> {
    const repository = manager.getRepository(Lead);
    const query = repository
      .createQueryBuilder("lead")
      .where("lead.tenantId = :tenantId", { tenantId: payload.tenantId })
      .andWhere(
        new Brackets((where) => {
          let hasCondition = false;
          if (payload.providerLeadId) {
            where.where(
              "(lead.provider = :provider AND lead.providerLeadId = :providerLeadId)",
              {
                provider: payload.provider,
                providerLeadId: payload.providerLeadId,
              },
            );
            hasCondition = true;
          }
          if (payload.email) {
            const method = hasCondition ? "orWhere" : "where";
            where[method]("lead.email = :email", { email: payload.email });
            hasCondition = true;
          }
          if (payload.phone) {
            const method = hasCondition ? "orWhere" : "where";
            where[method]("lead.phone = :phone", { phone: payload.phone });
          }
        }),
      );
    let lead = await query.getOne();
    const fullName =
      payload.fullName ||
      payload.email ||
      payload.phone ||
      `${payload.provider} lead`;
    const location = [
      payload.propertyAddress,
      payload.propertyCity,
      payload.propertyState,
      payload.propertyPostalCode,
    ]
      .filter((item): item is string => Boolean(item))
      .join(", ");

    if (!lead) {
      lead = repository.create({
        tenantId: payload.tenantId,
        fullName,
        email: payload.email ?? undefined,
        phone: payload.phone ?? undefined,
        emailEligible: payload.emailEligible,
        smsEligible: payload.smsEligible,
        provider: payload.provider,
        providerLeadId: payload.providerLeadId,
        ingestionFingerprint: fingerprint,
        communicationStatus: "active",
        source: payload.provider === "zillow" ? "Zillow" : "Realtor.com",
        location: location || undefined,
        propertyInterest: payload.sourceUrl ?? undefined,
        notes: payload.message ?? undefined,
        stage: "new",
        score: 65,
        leadType: "buyer",
        temperature: "warm",
        temperatureReason:
          "New provider lead; qualification is still in progress.",
        readinessLevel: "exploring",
        sequenceStatus: "idle",
        lastActivityAt: new Date(),
      });
      return repository.save(lead);
    }

    if (!lead.email && payload.email) lead.email = payload.email;
    if (!lead.phone && payload.phone) lead.phone = payload.phone;
    lead.emailEligible =
      lead.emailEligible || (Boolean(payload.email) && payload.emailEligible);
    lead.smsEligible =
      lead.smsEligible || (Boolean(payload.phone) && payload.smsEligible);
    if (!lead.provider || lead.provider === payload.provider) {
      lead.provider = payload.provider;
      lead.providerLeadId = payload.providerLeadId ?? lead.providerLeadId;
    }
    lead.ingestionFingerprint = fingerprint;
    if (!lead.fullName && fullName) lead.fullName = fullName;
    if (!lead.location && location) lead.location = location;
    if (!lead.propertyInterest && payload.sourceUrl) {
      lead.propertyInterest = payload.sourceUrl;
    }
    if (!lead.notes && payload.message) lead.notes = payload.message;
    lead.lastActivityAt = new Date();
    return repository.save(lead);
  }

  private async markTenantIntakeReceived(
    manager: EntityManager,
    tenantId: string,
    receivedAt: Date,
  ): Promise<void> {
    await manager
      .getRepository(TenantSettings)
      .update({ tenantId }, { intakeLastReceivedAt: receivedAt });
  }

  private contactValidationError(payload: IncomingLeadPayload): string | null {
    if (payload.emailEligible || payload.smsEligible) return null;
    return "No valid contact channel: email is missing or invalid; phone is missing or invalid";
  }

  private fingerprint(payload: IncomingLeadPayload): string {
    const hourBucket = payload.providerLeadId
      ? ""
      : payload.receivedAt.toISOString().slice(0, 13);
    return sha256(
      [
        payload.tenantId,
        payload.provider,
        payload.providerLeadId ?? "",
        payload.email ?? "",
        payload.phone ?? "",
        payload.fullName ?? "",
        payload.propertyAddress ?? "",
        hourBucket,
      ].join("|"),
    );
  }

  private resolveProvider(
    payload: Record<string, unknown>,
    headers: HeaderMap,
  ): LeadProvider {
    const supplied = firstText(
      headerValue(headers, "x-lead-provider"),
      payload.provider,
      payload.leadProvider,
      payload.lead_provider,
      payload.source,
    )
      ?.toLowerCase()
      .replace(/\.com$/, "")
      .replace(/[_\s-]+/g, "");
    if (supplied === "zillow") return "zillow";
    if (supplied === "realtor" || supplied === "realtorcom") return "realtor";
    throw new BadRequestException("provider must be zillow or realtor");
  }

  private extractApiKey(headers: HeaderMap): string {
    const direct = firstText(
      headerValue(headers, "x-ingestion-key"),
      headerValue(headers, "x-intake-key"),
      headerValue(headers, "x-api-key"),
    );
    if (direct) return direct;
    const authorization =
      firstText(headerValue(headers, "authorization")) ?? "";
    return /^Bearer\s+/i.test(authorization)
      ? authorization.replace(/^Bearer\s+/i, "").trim()
      : "";
  }

  private async resolveTenant(
    provider: LeadProvider,
    apiKey: string,
  ): Promise<string> {
    const keyHash = sha256(apiKey);
    const settings = await this.settingsRepository.findOne({
      where: { intakeApiKeyHash: keyHash },
    });
    if (settings?.tenantId && (await this.tenantExists(settings.tenantId))) {
      return settings.tenantId;
    }

    const providerNames =
      provider === "realtor" ? ["realtor_com", "realtor"] : ["zillow"];
    const direct = await this.credentialRepository.findOne({
      where: {
        provider: In(providerNames),
        ingestionKeyHash: keyHash,
      },
      relations: ["tenant"],
    });
    if (direct?.tenant?.id) return direct.tenant.id;

    if (provider === "realtor") {
      const legacyRows = await this.credentialRepository.find({
        where: { provider: In(providerNames), ingestionKeyHash: IsNull() },
        relations: ["tenant"],
      });
      const matches = legacyRows.filter((row) => {
        const config = decodeRealtorCredential(row.encryptedValue);
        return Boolean(
          config?.configured &&
          config.apiKey &&
          constantTimeEqual(config.apiKey, apiKey) &&
          row.tenant?.id,
        );
      });
      if (matches.length === 1 && matches[0].tenant?.id) {
        matches[0].ingestionKeyHash = keyHash;
        await this.credentialRepository.save(matches[0]);
        return matches[0].tenant.id;
      }
    }
    throw new UnauthorizedException("Invalid ingestion credential");
  }

  private async tenantExists(tenantId: string): Promise<boolean> {
    return (
      (await this.tenantRepository.count({ where: { id: tenantId } })) === 1
    );
  }
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeRealtorCredential(
  value: string,
): RealtorCredentialConfig | null {
  try {
    const parsed = asRecord(JSON.parse(decryptString(value)));
    if (!parsed) return null;
    return {
      configured: parsed.configured === true,
      apiKey: firstText(parsed.apiKey) ?? undefined,
    };
  } catch {
    return null;
  }
}

function normalizeCorrelationId(value: string): string {
  const supplied = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(supplied)
    ? supplied
    : `ingestion-${sha256(supplied || String(Date.now())).slice(0, 24)}`;
}
