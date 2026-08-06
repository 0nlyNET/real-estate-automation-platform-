import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/base.entity";

export type TwilioInboundProcessingResult =
  | "reply_recorded"
  | "opt_out_applied"
  | "lead_not_found"
  | "ambiguous_lead";

@Entity({ name: "twilio_inbound_messages" })
@Index("UQ_twilio_inbound_tenant_message_sid", ["tenantId", "messageSid"], {
  unique: true,
})
@Index("IDX_twilio_inbound_tenant_from_created", [
  "tenantId",
  "fromNumber",
  "createdAt",
])
export class TwilioInboundMessage extends BaseEntity {
  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "lead_id", type: "uuid", nullable: true })
  leadId?: string | null;

  @Column({ name: "message_sid", type: "varchar", length: 64 })
  messageSid!: string;

  @Column({
    name: "messaging_service_sid",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  messagingServiceSid?: string | null;

  @Column({ name: "from_number", type: "varchar", length: 20 })
  fromNumber!: string;

  @Column({ name: "to_number", type: "varchar", length: 20 })
  toNumber!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ name: "normalized_body", type: "text" })
  normalizedBody!: string;

  @Column({ name: "opt_out_type", type: "varchar", length: 50, nullable: true })
  optOutType?: string | null;

  @Column({ name: "is_opt_out", type: "boolean", default: false })
  isOptOut!: boolean;

  @Column({ name: "processing_result", type: "varchar", length: 50 })
  processingResult!: TwilioInboundProcessingResult;

  @Column({ name: "processed_at", type: "timestamptz" })
  processedAt!: Date;
}
