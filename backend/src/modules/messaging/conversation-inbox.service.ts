import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { isUUID } from "class-validator";
import { EntitlementService } from "../entitlements/entitlement.service";
import { ConversationAiState } from "../ai/conversation-ai-state.entity";
import { WorkspaceAiSettings } from "../ai/workspace-ai-settings.entity";
import { BrokerageKnowledge } from "../ai/brokerage-knowledge.entity";
import { PlatformAiControl } from "../ai/platform-ai-control.entity";
import { AiRun } from "../ai/ai-run.entity";
import { LeadHandoff } from "../client-operations/lead-handoff.entity";
import { Lead } from "../leads/lead.entity";

export type InboxAiStatus =
  | "AI Active"
  | "Human Takeover"
  | "AI Paused"
  | "Needs Attention";

@Injectable()
export class ConversationInboxService {
  constructor(
    private readonly source: DataSource,
    private readonly entitlements: EntitlementService,
  ) {}

  private async requireAccess(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    leadId?: string,
  ) {
    if (!tenantId || !userId)
      throw new ForbiddenException("Missing conversation identity");
    if (
      ![tenantId, userId, ...(leadId ? [leadId] : [])].every((id) => isUUID(id))
    ) {
      throw new BadRequestException("Invalid conversation identity");
    }
    // Shared inbox readers may update only their own read state. Reply/takeover
    // ownership remains enforced by the existing messaging/AI controllers.
    const rows = await manager.query(
      `
      SELECT u.id FROM users u
      WHERE u.id = $2 AND u."tenantId" = $1 AND u."isActive" = true
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM leads l WHERE l.id = $3 AND l.tenant_id = $1
        ))
    `,
      [tenantId, userId, leadId || null],
    );
    if (!rows.length) throw new ForbiddenException("Conversation not found");
  }

  async readStates(tenantId: string, userId: string, leadIds: string[]) {
    await this.requireAccess(this.source.manager, tenantId, userId);
    if (!leadIds.length) return [];
    const rows = await this.source.query(
      `
      SELECT l.id AS "leadId", r.last_read_message_id AS "lastReadMessageId",
        COALESCE(r.marked_unread, false) AS "markedUnread",
        COALESCE(r.unread_version, 0) AS "unreadVersion",
        (SELECT COUNT(*)::int FROM messages m
         WHERE m."leadId" = l.id AND m.direction = 'inbound'
         AND (r.last_read_at IS NULL OR
           (m.created_at, m.id) > (r.last_read_at, r.last_read_message_id))) AS "unreadCount"
      FROM leads l LEFT JOIN conversation_read_states r
        ON r.tenant_id = l.tenant_id AND r.lead_id = l.id AND r.user_id = $2
      WHERE l.tenant_id = $1 AND l.id = ANY($3::uuid[])
    `,
      [tenantId, userId, leadIds],
    );
    return rows.map((row: any) => ({
      ...row,
      isUnread: row.markedUnread || row.unreadCount > 0,
    }));
  }

  async markRead(
    tenantId: string,
    userId: string,
    leadId: string,
    messageId: string,
    unreadVersion: number,
  ) {
    if (
      !isUUID(messageId || "") ||
      !Number.isSafeInteger(unreadVersion) ||
      unreadVersion < 0
    ) {
      throw new BadRequestException(
        "A visible message and unread version are required",
      );
    }
    await this.source.transaction(async (manager) => {
      await this.requireAccess(manager, tenantId, userId, leadId);
      const message = await manager.query(
        `
        SELECT id FROM messages WHERE id = $1 AND "leadId" = $2
      `,
        [messageId, leadId],
      );
      if (!message.length)
        throw new BadRequestException(
          "Read watermark does not belong to this conversation",
        );
      await this.ensureState(manager, tenantId, userId, leadId);
      // Compare and copy in PostgreSQL: never use server-now, the thread's
      // newest message, or a client timestamp. Older concurrent reads cannot
      // move the watermark backwards; mark-unread invalidates old requests.
      // Outbound replies can clear a manual marker but cannot prove that any
      // preceding inbound message was visible in the client's snapshot.
      await manager.query(
        `
        UPDATE conversation_read_states r
        SET last_read_at = CASE WHEN m.direction = 'inbound' THEN m.created_at ELSE r.last_read_at END,
            last_read_message_id = CASE WHEN m.direction = 'inbound' THEN m.id ELSE r.last_read_message_id END,
            marked_unread = false, updated_at = now()
        FROM messages m
        WHERE r.tenant_id = $1 AND r.user_id = $2 AND r.lead_id = $3
          AND m.id = $4 AND m."leadId" = r.lead_id
          AND r.unread_version = $5
          AND (m.direction = 'outbound' OR r.last_read_at IS NULL OR
            (r.last_read_at, r.last_read_message_id) <= (m.created_at, m.id))
      `,
        [tenantId, userId, leadId, messageId, unreadVersion],
      );
    });
    return (await this.readStates(tenantId, userId, [leadId]))[0];
  }

  async markUnread(tenantId: string, userId: string, leadId: string) {
    await this.source.transaction(async (manager) => {
      await this.requireAccess(manager, tenantId, userId, leadId);
      await this.ensureState(manager, tenantId, userId, leadId);
      await manager.query(
        `
        UPDATE conversation_read_states SET marked_unread = true,
          unread_version = unread_version + 1, updated_at = now()
        WHERE tenant_id = $1 AND user_id = $2 AND lead_id = $3
      `,
        [tenantId, userId, leadId],
      );
    });
    return (await this.readStates(tenantId, userId, [leadId]))[0];
  }

  private ensureState(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    leadId: string,
  ) {
    return manager.query(
      `
      INSERT INTO conversation_read_states (tenant_id, user_id, lead_id)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
    `,
      [tenantId, userId, leadId],
    );
  }

  async aiSummaries(
    tenantId: string,
    threads: { leadId: string; channel: string }[],
  ) {
    const leadIds = threads.map((thread) => thread.leadId);
    if (!leadIds.length)
      return new Map<
        string,
        { aiStatus: InboxAiStatus; aiStatusReason: string | null }
      >();
    const [states, settings, knowledge, platform, leads, runs, handoffs] =
      await Promise.all([
        this.source
          .getRepository(ConversationAiState)
          .find({ where: { tenantId, leadId: In(leadIds) } }),
        this.source
          .getRepository(WorkspaceAiSettings)
          .findOne({ where: { tenantId } }),
        this.source
          .getRepository(BrokerageKnowledge)
          .findOne({ where: { tenantId } }),
        this.source
          .getRepository(PlatformAiControl)
          .findOne({ where: { id: "global" } }),
        this.source.getRepository(Lead).find({
          where: { tenantId, id: In(leadIds) },
          select: { id: true, testRunId: true },
        }),
        this.source
          .getRepository(AiRun)
          .createQueryBuilder("run")
          .distinctOn(["run.leadId"])
          .where("run.tenantId = :tenantId", { tenantId })
          .andWhere("run.leadId IN (:...leadIds)", { leadIds })
          .orderBy("run.leadId")
          .addOrderBy("run.createdAt", "DESC")
          .addOrderBy("run.id", "DESC")
          .getMany(),
        this.source.getRepository(LeadHandoff).find({
          where: {
            tenantId,
            leadId: In(leadIds),
            status: In(["open", "opened", "snoozed"]),
          },
        }),
      ]);
    // Match runtime preflight's channel action and persisted controlled-test
    // context. Cache the four possible decisions within this inbox request.
    const decisions = new Map<
      string,
      ReturnType<EntitlementService["evaluate"]>
    >();
    const entitlements = await Promise.all(
      threads.map(({ leadId, channel }) => {
        const controlledTest = Boolean(
          leads.find((lead) => lead.id === leadId)?.testRunId,
        );
        const action =
          channel === "sms" ? "send_automated_sms" : "send_automated_email";
        const key = `${action}:${controlledTest}`;
        if (!decisions.has(key))
          decisions.set(
            key,
            this.entitlements.evaluate(tenantId, action, new Date(), {
              controlledTest,
            }),
          );
        return decisions.get(key)!;
      }),
    );
    return new Map(
      threads.map(({ leadId }, index) => {
        const entitlement = entitlements[index];
        const state = states.find((row) => row.leadId === leadId);
        const run = runs.find((row) => row.leadId === leadId);
        const handoff = handoffs.find((row) => row.leadId === leadId);
        let aiStatus: InboxAiStatus = "AI Active";
        let aiStatusReason: string | null = null;
        if (state?.ownershipStatus === "waiting_for_human" || handoff) {
          aiStatus = "Needs Attention";
          aiStatusReason =
            state?.escalationReason ||
            handoff?.reason ||
            "Human review required";
        } else if (state?.ownershipStatus === "human_handling") {
          aiStatus = "Human Takeover";
          aiStatusReason =
            state.aiPausedReason || "A team member controls this conversation";
        } else if (
          process.env.GLOBAL_AUTOMATIONS_DISABLED === "true" ||
          platform?.paused ||
          settings?.aiPaused ||
          state?.ownershipStatus === "paused" ||
          state?.ownershipStatus === "closed" ||
          !settings?.aiEnabled ||
          settings.responseMode === "human_only" ||
          !entitlement.allowed
        ) {
          aiStatus = "AI Paused";
          aiStatusReason =
            process.env.GLOBAL_AUTOMATIONS_DISABLED === "true"
              ? "Platform automation is globally paused"
              : platform?.paused
                ? platform.reason || "Platform AI is paused"
                : settings?.aiPaused
                  ? settings.aiPausedReason || "Workspace AI is paused"
                  : state?.aiPausedReason ||
                    entitlement.reasons.join("; ") ||
                    "AI is disabled or paused";
        } else if (
          !state ||
          !process.env.OPENAI_API_KEY?.trim() ||
          settings.configurationApprovalStatus !== "approved" ||
          knowledge?.approvalStatus !== "approved" ||
          !settings.identityLabel?.trim() ||
          (run &&
            ["blocked", "failed", "drafted"].includes(run.status) &&
            (!state.returnedToAiAt || run.createdAt >= state.returnedToAiAt))
        ) {
          aiStatus = "Needs Attention";
          aiStatusReason =
            run?.sanitizedError ||
            "AI setup, approval, or conversation review is required";
        }
        return [leadId, { aiStatus, aiStatusReason }];
      }),
    );
  }
}
