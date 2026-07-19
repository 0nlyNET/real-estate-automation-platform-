import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { OperationsService } from '../operations/operations.service';
import { ProspectApplication } from './prospect-application.entity';
import { operationalEvent } from '../../common/operational-log';

type Inquiry = {
  name?: string;
  email: string;
  company?: string;
  phone?: string;
  website?: string;
  estimatedMonthlyLeadVolume?: number;
  requestedService?: string;
  topic?: string;
  message: string;
  source?: string;
};

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    @InjectRepository(ProspectApplication)
    private readonly applications: Repository<ProspectApplication>,
    private readonly mail: MailService,
    private readonly operations: OperationsService,
  ) {}

  async submitInquiry(inquiry: Inquiry) {
    const application = await this.applications.save(
      this.applications.create({
        name: String(inquiry.name || 'Prospective client').trim(),
        email: inquiry.email.trim().toLowerCase(),
        phone: inquiry.phone?.trim() || null,
        company: inquiry.company?.trim() || null,
        website: inquiry.website?.trim() || null,
        estimatedMonthlyLeadVolume: inquiry.estimatedMonthlyLeadVolume ?? null,
        requestedService: inquiry.requestedService?.trim() || null,
        message: inquiry.message.trim(),
        source: inquiry.source?.trim() || 'website',
        status: 'new',
        notificationStatus: 'pending',
      }),
    );

    await this.operations.createTask({
      applicationId: application.id,
      category: 'new_application',
      title: `Review application from ${application.name}`,
      description: `Review the persisted application and record qualification and consultation status.`,
      priority: 'normal',
      relatedEntityType: 'prospect_application',
      relatedEntityId: application.id,
      dedupeOpen: true,
    });

    const salesInbox = (process.env.SALES_INBOX_EMAIL || '').trim();
    const errors: string[] = [];
    let operatorSent = false;
    let applicantSent = false;

    if (!salesInbox) {
      errors.push('Sales inbox is not configured');
    } else {
      try {
      const subjectTopic = (inquiry.topic || 'sales').toString().toUpperCase();
      const subject = `[RealtyTechAI] ${subjectTopic} inquiry from ${inquiry.email}`;

      const lines = [
        `Topic: ${inquiry.topic || 'sales'}`,
        `Name: ${inquiry.name || ''}`,
        `Email: ${inquiry.email}`,
        `Company: ${inquiry.company || ''}`,
        `Source: ${inquiry.source || ''}`,
        '',
        inquiry.message,
      ];

      await this.mail.sendEmail({
        to: salesInbox,
        subject,
        text: lines.join('\n'),
      });
        operatorSent = true;
      } catch (error: unknown) {
        errors.push(
          `Operator notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    try {
      await this.mail.sendEmail({
        to: application.email,
        subject: 'We received your RealtyTechAI application',
        text:
          `Your application was received. Our team will review it and contact you using the information provided.\n\n` +
          `Reference: ${application.id}`,
      });
      applicantSent = true;
    } catch (error: unknown) {
      errors.push(
        `Applicant confirmation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    application.notificationStatus =
      operatorSent && applicantSent
        ? 'sent'
        : operatorSent || applicantSent
          ? 'partial'
          : 'failed';
    application.notificationError = errors.length
      ? errors.join('; ').slice(0, 2000)
      : null;
    await this.applications.save(application);

    if (errors.length) {
      await this.operations.createTask({
        applicationId: application.id,
        category: 'application_notification_failure',
        title: `Application notification failed for ${application.name}`,
        description: 'The application is safely persisted. Contact the prospect and review system email configuration.',
        priority: 'high',
        relatedEntityType: 'prospect_application',
        relatedEntityId: application.id,
        evidenceNote: application.notificationError,
        dedupeOpen: true,
      });
      this.logger.warn(
        operationalEvent('application_notification_failed', {
          applicationId: application.id,
          notificationStatus: application.notificationStatus,
        }),
      );
    }

    return {
      ok: true,
      received: true,
      applicationId: application.id,
      message:
        'Your application was received. Our team will review it and contact you using the information provided.',
    };
  }

  listApplications(status?: string, take = 50, skip = 0) {
    return this.applications.find({
      where: status ? ({ status } as any) : {},
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(take, 1), 200),
      skip: Math.max(skip, 0),
    });
  }

  async updateApplication(
    id: string,
    patch: Partial<Pick<ProspectApplication, 'status' | 'operatorNotes' | 'assignedOperatorId'>>,
  ) {
    const application = await this.applications.findOne({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    if (patch.status !== undefined) application.status = patch.status;
    if (patch.operatorNotes !== undefined)
      application.operatorNotes = patch.operatorNotes;
    if (patch.assignedOperatorId !== undefined)
      application.assignedOperatorId = patch.assignedOperatorId;
    return this.applications.save(application);
  }

  async createOnboardingTask(id: string) {
    const application = await this.applications.findOne({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    return this.operations.createTask({
      applicationId: application.id,
      category: 'onboarding_task',
      title: `Prepare onboarding for ${application.company || application.name}`,
      description: 'Confirm commercial fit, assign an onboarding owner, provision a safe inactive workspace, and schedule intake.',
      priority: 'high',
      relatedEntityType: 'prospect_application',
      relatedEntityId: application.id,
      dedupeOpen: true,
    });
  }
}
