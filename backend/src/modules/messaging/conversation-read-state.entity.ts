import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { Lead } from "../leads/lead.entity";
import { Tenant } from "../tenants/tenant.entity";
import { User } from "../users/user.entity";

@Entity("conversation_read_states")
export class ConversationReadState {
  @PrimaryColumn({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @PrimaryColumn({ name: "lead_id", type: "uuid" })
  leadId!: string;

  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;

  @ManyToOne(() => Lead, { onDelete: "CASCADE" })
  @JoinColumn({ name: "lead_id" })
  lead!: Lead;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  // Match messages.created_at, preserving database microseconds in SQL.
  @Column({ name: "last_read_at", type: "timestamp", nullable: true })
  lastReadAt!: Date | null;

  @Column({ name: "last_read_message_id", type: "uuid", nullable: true })
  lastReadMessageId!: string | null;

  @Column({ name: "marked_unread", type: "boolean", default: false })
  markedUnread!: boolean;

  // A mark-unread invalidates any read request from an older page snapshot.
  @Column({ name: "unread_version", type: "int", default: 0 })
  unreadVersion!: number;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
