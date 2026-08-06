import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/base.entity";
import { LeadProvider } from "./lead-ingestion.types";

export type LeadIngestionStatus = "accepted" | "failed_validation";

@Entity({ name: "lead_ingestion_events" })
@Index(
  "UQ_lead_ingestion_tenant_provider_key",
  ["tenantId", "provider", "idempotencyKey"],
  {
    unique: true,
  },
)
@Index("IDX_lead_ingestion_tenant_created", ["tenantId", "createdAt"])
export class LeadIngestionEvent extends BaseEntity {
  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ type: "varchar", length: 30 })
  provider!: LeadProvider;

  @Column({
    name: "provider_lead_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  providerLeadId?: string | null;

  @Column({ name: "idempotency_key", type: "varchar", length: 100 })
  idempotencyKey!: string;

  @Column({ name: "ingestion_fingerprint", type: "varchar", length: 64 })
  ingestionFingerprint!: string;

  @Column({ type: "varchar", length: 30 })
  status!: LeadIngestionStatus;

  @Column({ name: "validation_error", type: "text", nullable: true })
  validationError?: string | null;

  @Column({ name: "correlation_id", type: "varchar", length: 100 })
  correlationId!: string;

  @Column({ name: "payload_metadata", type: "jsonb" })
  payloadMetadata!: Record<string, unknown>;

  @Column({ name: "lead_id", type: "uuid", nullable: true })
  leadId?: string | null;

  @Column({ name: "provider_received_at", type: "timestamptz" })
  providerReceivedAt!: Date;

  @Column({ name: "processed_at", type: "timestamptz" })
  processedAt!: Date;
}
