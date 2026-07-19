import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';
import { MailService } from '../../mail/mail.service';
import { OperationsService } from '../operations/operations.service';
import { operationalEvent } from '../../common/operational-log';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly repo: Repository<SupportTicket>,
    private readonly mail: MailService,
    private readonly operations: OperationsService,
  ) {}

  async createTicket(params: {
    tenantId: string;
    userId: string;
    email: string;
    name?: string | null;
    subject: string;
    message: string;
    severity?: SupportTicket['severity'];
  }) {
    const ticket = this.repo.create({
      tenant: { id: params.tenantId } as any,
      tenantId: params.tenantId,
      userId: params.userId,
      email: params.email,
      name: params.name || null,
      subject: params.subject.trim(),
      message: params.message.trim(),
      status: 'open',
      severity: params.severity || 'normal',
      dueAt: new Date(
        Date.now() +
          (params.severity === 'urgent' ? 4 : params.severity === 'high' ? 24 : 48) *
            60 *
            60 *
            1000,
      ),
    });

    const saved = await this.repo.save(ticket);
    await this.operations.createTask({
      tenantId: params.tenantId,
      category: 'support_request',
      title: saved.subject,
      description: saved.message,
      priority:
        saved.severity === 'urgent'
          ? 'critical'
          : saved.severity === 'high'
            ? 'high'
            : 'normal',
      dueAt: saved.dueAt,
      relatedEntityType: 'support_ticket',
      relatedEntityId: saved.id,
      dedupeOpen: true,
    });
    if (saved.severity === 'high' || saved.severity === 'urgent') {
      this.logger.warn(
        operationalEvent('support_escalation', {
          tenantId: params.tenantId,
          ticketId: saved.id,
          severity: saved.severity,
          dueAt: saved.dueAt,
        }),
      );
    }
    const inbox = String(process.env.SALES_INBOX_EMAIL || '').trim();
    let notificationSent = false;
    if (inbox) {
      try {
        await this.mail.sendEmail({
          to: inbox,
          subject: `[RealtyTechAI support] ${saved.subject}`,
          text:
            `Ticket: ${saved.id}\n` +
            `Workspace: ${params.tenantId}\n` +
            `User: ${params.email}\n\n` +
            `${saved.message}`,
        });
        notificationSent = true;
      } catch (error: unknown) {
        this.logger.warn(
          operationalEvent('support_notification_failed', {
            tenantId: params.tenantId,
            ticketId: saved.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    } else {
      this.logger.warn(
        operationalEvent('support_notification_not_configured', {
          tenantId: params.tenantId,
          ticketId: saved.id,
        }),
      );
    }

    try {
      await this.mail.sendEmail({
        to: params.email,
        subject: 'We received your RealtyTechAI support request',
        text: `Your support request was saved. Reference: ${saved.id}\n\nYou can reply to the support email thread if more context is needed.`,
      });
    } catch {
      this.logger.warn(
        operationalEvent('support_acknowledgment_failed', {
          tenantId: params.tenantId,
          ticketId: saved.id,
        }),
      );
    }

    return { ok: true, ticketId: saved.id, notificationSent };
  }

  listTickets(status?: SupportTicket['status']) {
    return this.repo.find({
      where: status ? { status } : {},
      order: { severity: 'DESC', dueAt: 'ASC', createdAt: 'DESC' },
      take: 200,
    });
  }

  async updateTicket(id: string, patch: {
    status?: SupportTicket['status'];
    assignedOperatorId?: string | null;
    dueAt?: string | null;
    resolutionNote?: string | null;
  }) {
    const ticket = await this.repo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    if (patch.status !== undefined) ticket.status = patch.status;
    if (patch.assignedOperatorId !== undefined) ticket.assignedOperatorId = patch.assignedOperatorId;
    if (patch.dueAt !== undefined) ticket.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
    if (patch.resolutionNote !== undefined) ticket.resolutionNote = patch.resolutionNote;
    if (ticket.status === 'acknowledged' && !ticket.acknowledgedAt) ticket.acknowledgedAt = new Date();
    if (ticket.status === 'resolved' && !ticket.resolvedAt) ticket.resolvedAt = new Date();
    if (ticket.status === 'open') {
      ticket.acknowledgedAt = null;
      ticket.resolvedAt = null;
    }
    return this.repo.save(ticket);
  }

  async createAccountRequest(params: {
    tenantId: string;
    userId: string;
    email: string;
    kind: 'cancellation' | 'deletion';
    requestedEffectiveDate?: string;
    note?: string;
  }) {
    const task = await this.operations.createTask({
      tenantId: params.tenantId,
      category:
        params.kind === 'cancellation'
          ? 'cancellation_request'
          : 'deletion_request',
      title:
        params.kind === 'cancellation'
          ? 'Client cancellation request'
          : 'Client data deletion request',
      description:
        `Requester: ${params.email} (${params.userId})\n` +
        `Requested effective date: ${params.requestedEffectiveDate || 'not specified'}\n` +
        `Note: ${params.note || 'none'}`,
      priority: 'high',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      relatedEntityType: 'tenant',
      relatedEntityId: params.tenantId,
    });

    await this.operations.createTask({
      tenantId: params.tenantId,
      category: params.kind === 'cancellation' ? 'billing_follow_up' : 'data_governance',
      title: params.kind === 'cancellation' ? 'Reconcile billing cancellation' : 'Verify export and deletion scope',
      description: params.kind === 'cancellation'
        ? 'Confirm Stripe effective date, access window, and cancellation confirmation before changing service state.'
        : 'Verify requester identity, retention obligations, export requirements, and approved deletion scope. Do not auto-delete.',
      priority: 'high',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      relatedEntityType: 'operations_task',
      relatedEntityId: task.id,
    });
    await this.operations.createTask({
      tenantId: params.tenantId,
      category: 'provider_disable_follow_up',
      title: 'Review provider and automation shutdown',
      description: 'Pause automation immediately when authorized, then disable provider paths at the approved effective time without deleting evidence.',
      priority: 'high',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      relatedEntityType: 'operations_task',
      relatedEntityId: task.id,
    });

    this.logger.warn(
      operationalEvent('account_service_request', {
        tenantId: params.tenantId,
        requestId: task.id,
        kind: params.kind,
        requestedEffectiveDate: params.requestedEffectiveDate || null,
      }),
    );

    let notificationSent = false;
    const inbox = String(process.env.SALES_INBOX_EMAIL || '').trim();
    if (inbox) {
      try {
        await this.mail.sendEmail({
          to: inbox,
          subject: `[RealtyTechAI] ${task.title}`,
          text: `${task.description}\n\nOperations task: ${task.id}`,
        });
        notificationSent = true;
      } catch (error: unknown) {
        this.logger.warn(
          operationalEvent('account_request_notification_failed', {
            tenantId: params.tenantId,
            requestId: task.id,
            kind: params.kind,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    try {
      await this.mail.sendEmail({
        to: params.email,
        subject: params.kind === 'cancellation'
          ? 'We received your cancellation request'
          : 'We received your data deletion request',
        text: `Your request was recorded for operator review. Reference: ${task.id}\n\nNo production data is automatically deleted by this request.`,
      });
    } catch {
      this.logger.warn(
        operationalEvent('account_request_acknowledgment_failed', {
          tenantId: params.tenantId,
          requestId: task.id,
          kind: params.kind,
        }),
      );
    }
    return { ok: true, requestId: task.id, notificationSent };
  }
}
