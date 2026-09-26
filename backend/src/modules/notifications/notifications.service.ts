import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as webPush from 'web-push';
import { platformAdminEmails, platformStaffEmails, resolvePlatformRole } from '../../common/env';
import { operationalEvent } from '../../common/operational-log';
import { MailService } from '../../mail/mail.service';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { User } from '../users/user.entity';
import {
  AdminNotification,
  NotificationCategory,
  NotificationSeverity,
} from './notification.entity';
import { AdminNotificationPreference } from './notification-preference.entity';
import { AdminPushSubscription } from './push-subscription.entity';
import {
  canonicalActionUrl,
  getTemplate,
  TemplateContext,
} from './notification-templates';

type PlatformAudience = 'super_admin' | 'operators';

export type CreatePlatformNotification = {
  eventType: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  deduplicationKey: string;
  audience?: PlatformAudience;
  assignedOperatorId?: string | null;
  actionUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  incidentKey?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * When set, notifications go to exactly these users (verified to be
   * platform operators for platform notifications, or members of the tenant
   * for tenant notifications). Used by digests, which are per-recipient.
   */
  exactRecipientIds?: string[] | null;
  /**
   * When set, the email subject/html/text are rendered from the template
   * registry instead of the raw title/message. The in-app title/message
   * fall back to the rendered subject/textBody.
   */
  templateId?: string | null;
  templateContext?: TemplateContext | null;
};

export type CreateTenantNotification = Omit<
  CreatePlatformNotification,
  'audience' | 'assignedOperatorId'
> & {
  tenantId: string;
  assignedUserId?: string | null;
};

const DEFAULT_CATEGORIES: Record<NotificationCategory, boolean> = {
  leads: true,
  clients: true,
  onboarding: true,
  billing: true,
  tasks: true,
  support: true,
  integrations: true,
  system: true,
};
const DEFAULT_SEVERITIES = { info: false, success: true, warning: true, critical: true };
const NOTIFICATION_CATEGORIES = new Set<NotificationCategory>([
  'leads', 'clients', 'onboarding', 'billing', 'tasks', 'support', 'integrations', 'system',
]);
const NOTIFICATION_SEVERITIES = new Set<NotificationSeverity>([
  'info', 'success', 'warning', 'critical',
]);
const WEB_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
];

/** Reserved metadata key carrying the serialized template context for retries. */
const TEMPLATE_CONTEXT_METADATA_KEY = '__templateContext';
/** Max email send attempts per notification (initial + retries). */
const EMAIL_MAX_ATTEMPTS = 3;
/** Exponential backoff delays (minutes) after attempt 1 and 2 fail. */
const EMAIL_RETRY_BACKOFF_MINUTES = [1, 5, 15];
const EMAIL_RETRY_TASK_TYPE = 'notifications.email_retry';

/**
 * Strip anything secret-looking from a provider error before persisting or
 * logging it. Never persist raw tokens, keys, or authorization headers.
 */
export function sanitizeProviderError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message
    .replace(/(api[_-]?key|apikey)\s*[:=]\s*['"]?[^\s'"]+/gi, '$1=[redacted]')
    .replace(/(authorization\s*:\s*)(bearer\s+)?[^\s,;]+/gi, '$1[redacted]')
    .replace(/(token|secret|password)\s*[:=]\s*['"]?[^\s'"]+/gi, '$1=[redacted]')
    .replace(/x-api-key:\s*[^\s,;]+/gi, 'x-api-key: [redacted]')
    .replace(/SG\.[A-Za-z0-9_-]{10,}/g, 'SG.[redacted]');
  return message.slice(0, 500);
}

export function assertSafePushEndpoint(value: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new BadRequestException('Invalid push subscription endpoint');
  }
  const hostname = endpoint.hostname.toLowerCase();
  const allowed = WEB_PUSH_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    !allowed
  ) {
    throw new BadRequestException('Push subscription endpoint is not trusted');
  }
  endpoint.hash = '';
  return endpoint.toString();
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pushConfigured: boolean;

  constructor(
    @InjectRepository(AdminNotification)
    private readonly notifications: Repository<AdminNotification>,
    @InjectRepository(AdminPushSubscription)
    private readonly subscriptions: Repository<AdminPushSubscription>,
    @InjectRepository(AdminNotificationPreference)
    private readonly preferences: Repository<AdminNotificationPreference>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly mailService: MailService,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {
    const subject = String(process.env.VAPID_SUBJECT || '').trim();
    const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    let configured = Boolean(subject && publicKey && privateKey);
    if (configured) {
      try {
        webPush.setVapidDetails(subject, publicKey, privateKey);
      } catch (error: unknown) {
        configured = false;
        this.logger.error(
          operationalEvent('web_push_configuration_invalid', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    this.pushConfigured = configured;
  }

  onModuleInit() {
    if (!this.durableJobs) return;
    this.durableJobs.register(EMAIL_RETRY_TASK_TYPE, async (job) => {
      const notificationId = String((job.payload as any)?.notificationId || '');
      if (notificationId) await this.retryEmailDelivery(notificationId);
    });
  }

  /**
   * Durable retry handler for failed notification emails. Re-renders the
   * email from the stored template (or the stored title/message) and attempts
   * delivery again; deliverEmail() schedules the next backoff or records
   * exhaustion.
   */
  async retryEmailDelivery(notificationId: string) {
    const notification = await this.notifications.findOne({
      where: { id: notificationId },
    });
    if (!notification) return;
    if (notification.emailDeliveryStatus !== 'failed') return;
    if (notification.emailAttemptCount >= EMAIL_MAX_ATTEMPTS) return;
    const preference = await this.getPreferences(notification.recipientUserId);
    await this.deliverEmail(notification, preference);
  }

  /**
   * Resolve the rendered email content for a notification create input. When
   * a templateId is supplied, subject/html/text come from the template
   * registry; the in-app title/message fall back to the rendered subject
   * and text body when the caller did not provide explicit ones.
   */
  private resolveRenderedContent(input: CreatePlatformNotification | CreateTenantNotification): {
    title: string;
    message: string;
    htmlBody: string | null;
    templateId: string | null;
    templateContext: TemplateContext | null;
  } {
    const templateId = input.templateId || null;
    if (!templateId) {
      return {
        title: input.title,
        message: input.message,
        htmlBody: null,
        templateId: null,
        templateContext: null,
      };
    }
    const template = getTemplate(templateId);
    if (!template) {
      throw new BadRequestException(`Unknown notification template: ${templateId}`);
    }
    const ctx: TemplateContext = { ...(input.templateContext || {}) };
    // The stored actionUrl path is always available to templates.
    if (input.actionUrl && !ctx.actionPath) ctx.actionPath = input.actionUrl;
    return {
      title: input.title || template.subject(ctx),
      message: input.message || template.textBody(ctx),
      htmlBody: template.htmlBody(ctx),
      templateId,
      templateContext: ctx,
    };
  }

  private ensureActionUrl(value?: string | null) {
    if (!value) return null;
    if (
      (!value.startsWith('/admin') && !value.startsWith('/app')) ||
      value.startsWith('//') ||
      value.includes('://')
    ) {
      throw new BadRequestException('Notification action must be an internal RealtyTechAI URL');
    }
    return value;
  }

  private async recipientIds(input: CreatePlatformNotification) {
    const ownerOnly =
      input.audience === 'super_admin' ||
      input.category === 'billing' ||
      input.category === 'system';
    if (input.exactRecipientIds) {
      // Exact targeting, guarded: only verified platform operators may be
      // targeted by platform notifications. An explicitly empty list means
      // no recipients (used by digests when nobody opted in).
      if (!input.exactRecipientIds.length) return [];
      const users = await this.users.find({
        where: { id: In(input.exactRecipientIds), isActive: true, isEmailVerified: true },
      });
      return users
        .filter(
          (user) =>
            resolvePlatformRole(user.email, user.platformRole) !== null,
        )
        .map((user) => user.id);
    }
    if (input.assignedOperatorId) {
      const assigned = await this.users.findOne({
        where: { id: input.assignedOperatorId, isActive: true, isEmailVerified: true },
      });
      const role = assigned
        ? resolvePlatformRole(assigned.email, assigned.platformRole)
        : null;
      if (assigned && role && (!ownerOnly || role === 'super_admin')) return [assigned.id];
      return [];
    }
    const emails =
      ownerOnly
        ? [...platformAdminEmails()]
        : [...new Set([...platformAdminEmails(), ...platformStaffEmails()])];
    const where: any[] = [];
    if (emails.length) where.push({ email: In(emails), isActive: true, isEmailVerified: true });
    if (!ownerOnly) {
      where.push({ platformRole: 'staff', isActive: true, isEmailVerified: true });
    }
    if (!where.length) return [];
    const users = await this.users.find({
      where,
    });
    return users
      .filter((user) => {
        const role = resolvePlatformRole(user.email, user.platformRole);
        if (ownerOnly) return role === 'super_admin';
        return role !== null;
      })
      .map((user) => user.id);
  }

  async createForPlatform(input: CreatePlatformNotification) {
    try {
      const actionUrl = this.ensureActionUrl(input.actionUrl);
      const recipientIds = await this.recipientIds(input);
      // NOTE: `return await` (not bare `return`) so rejections from
      // createForRecipients are caught by the catch block below. A bare
      // `return promise` inside try does NOT route the rejection to catch.
      return await this.createForRecipients(input, actionUrl, recipientIds);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('admin_notification_creation_failed', {
          eventType: input.eventType,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }

  async createForTenant(input: CreateTenantNotification) {
    try {
      const actionUrl = this.ensureActionUrl(input.actionUrl);
      const tenantUsers = await this.users.find({
        where: {
          tenantId: input.tenantId,
          isActive: true,
          isEmailVerified: true,
        },
      });
      const tenantUserIds = new Set(tenantUsers.map((user) => user.id));
      let recipientIds: string[];
      if (input.exactRecipientIds) {
        // Tenant isolation: only users verified to belong to this tenant.
        // An explicitly empty list means no recipients.
        recipientIds = [...new Set(input.exactRecipientIds)].filter((id) =>
          tenantUserIds.has(id),
        );
      } else {
        recipientIds = tenantUsers
          .filter((user) => {
            if (user.role === 'read_only') return false;
            // Billing notifications go to workspace owners only — never agents.
            if (input.category === 'billing' && !input.assignedUserId) {
              return user.role === 'owner';
            }
            if (!input.assignedUserId) return user.role === 'owner' || user.role === 'admin';
            return (
              user.id === input.assignedUserId ||
              user.role === 'owner' ||
              user.role === 'admin'
            );
          })
          .map((user) => user.id);
      }
      // NOTE: `return await` (not bare `return`) so rejections from
      // createForRecipients are caught by the catch block below.
      return await this.createForRecipients(input, actionUrl, [...new Set(recipientIds)]);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('client_notification_creation_failed', {
          tenantId: input.tenantId,
          eventType: input.eventType,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }

  private async createForRecipients(
    input: CreatePlatformNotification | CreateTenantNotification,
    actionUrl: string | null,
    recipientIds: string[],
  ) {
    const rendered = this.resolveRenderedContent(input);
    // Persist the template context (serialized) so email retries can
    // re-render the exact same content in a later job run.
    const metadata: Record<string, string | number | boolean | null> = {
      ...(input.metadata || {}),
    };
    if (rendered.templateId && rendered.templateContext) {
      metadata[TEMPLATE_CONTEXT_METADATA_KEY] = JSON.stringify(rendered.templateContext).slice(0, 4000);
    }
    const created: AdminNotification[] = [];
    for (const recipientUserId of recipientIds) {
      const preference = await this.getPreferences(recipientUserId);
      if (!preference.inAppEnabled && !preference.pushEnabled && !preference.emailEnabled) continue;
      let notification = await this.notifications.findOne({
        where: {
          recipientUserId,
          deduplicationKey: input.deduplicationKey,
        },
      });
      if (notification) {
        created.push(notification);
        continue;
      }
      try {
        notification = await this.notifications.save(
          this.notifications.create({
            recipientUserId,
            eventType: input.eventType,
            category: input.category,
            severity: input.severity,
            title: rendered.title.slice(0, 180),
            message: rendered.message.slice(0, 2000),
            actionUrl,
            entityType: input.entityType || null,
            entityId: input.entityId || null,
            deduplicationKey: input.deduplicationKey.slice(0, 255),
            incidentKey: input.incidentKey?.slice(0, 255) || null,
            templateId: rendered.templateId,
            metadata,
            emailAttemptCount: 0,
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          }),
        );
      } catch (error: any) {
        if (String(error?.code || '') === '23505') {
          const concurrent = await this.notifications.findOne({
            where: { recipientUserId, deduplicationKey: input.deduplicationKey },
          });
          if (concurrent) created.push(concurrent);
          continue;
        }
        throw error;
      }
      created.push(notification);
      await this.deliverPush(notification, preference);
      await this.deliverEmail(notification, preference);
    }
    return created;
  }

  async listForUser(
    recipientUserId: string,
    filters: {
      unread?: boolean;
      read?: 'read' | 'unread';
      category?: string;
      severity?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const preference = await this.getPreferences(recipientUserId);
    if (!preference.inAppEnabled) return [];
    const take = Math.min(Math.max(filters.take || 30, 1), 100);
    const skip = Math.max(filters.skip || 0, 0);
    const readFilter = filters.read || (filters.unread ? 'unread' : undefined);
    const category = NOTIFICATION_CATEGORIES.has(filters.category as NotificationCategory)
      ? filters.category as NotificationCategory
      : undefined;
    const severity = NOTIFICATION_SEVERITIES.has(filters.severity as NotificationSeverity)
      ? filters.severity as NotificationSeverity
      : undefined;
    return this.notifications.find({
      where: {
        recipientUserId,
        ...(readFilter === 'unread' ? { readAt: IsNull() } : {}),
        ...(readFilter === 'read' ? { readAt: Not(IsNull()) } : {}),
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
      },
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
  }

  async summary(recipientUserId: string) {
    const preference = await this.getPreferences(recipientUserId);
    const unread = preference.inAppEnabled
      ? await this.notifications.count({ where: { recipientUserId, readAt: IsNull() } })
      : 0;
    const activeDevices = await this.subscriptions.count({
      where: { recipientUserId, active: true },
    });
    return { unread, activeDevices, pushConfigured: this.pushConfigured };
  }

  async markRead(recipientUserId: string, id: string) {
    const row = await this.notifications.findOne({ where: { id, recipientUserId } });
    if (!row) throw new NotFoundException('Notification not found');
    row.readAt = row.readAt || new Date();
    await this.notifications.save(row);
    return { ok: true };
  }

  async markAllRead(recipientUserId: string) {
    await this.notifications
      .createQueryBuilder()
      .update(AdminNotification)
      .set({ readAt: new Date() })
      .where('recipient_user_id = :recipientUserId', { recipientUserId })
      .andWhere('read_at IS NULL')
      .execute();
    return { ok: true };
  }

  async getPreferences(recipientUserId: string) {
    let preference = await this.preferences.findOne({ where: { recipientUserId } });
    if (!preference) {
      // Multiple first-login requests may initialize preferences simultaneously.
      // A competing insert must preserve the existing user's choices.
      await this.preferences.createQueryBuilder().insert().values({
        recipientUserId,
        inAppEnabled: true,
        pushEnabled: true,
        emailEnabled: true,
        privacyMode: true,
        categorySettings: DEFAULT_CATEGORIES,
        severitySettings: DEFAULT_SEVERITIES,
        quietHoursEnabled: false,
        quietHoursStart: '21:00',
        quietHoursEnd: '08:00',
        timezone: 'America/New_York',
        dailyDigestEnabled: true,
        weeklyDigestEnabled: false,
      }).orIgnore().execute();
      preference = await this.preferences.findOne({ where: { recipientUserId } });
      if (!preference) throw new Error('Notification preferences could not be initialized');
    }
    return preference;
  }

  async updatePreferences(
    recipientUserId: string,
    patch: Partial<AdminNotificationPreference>,
  ) {
    const preference = await this.getPreferences(recipientUserId);
    for (const key of [
      'inAppEnabled',
      'pushEnabled',
      'emailEnabled',
      'privacyMode',
      'quietHoursEnabled',
      'quietHoursStart',
      'quietHoursEnd',
      'timezone',
      'dailyDigestEnabled',
      'weeklyDigestEnabled',
    ] as const) {
      if (patch[key] !== undefined) (preference as any)[key] = patch[key];
    }
    if (patch.categorySettings) {
      const categoryPatch = Object.fromEntries(
        Object.entries(patch.categorySettings).filter(
          ([key, value]) =>
            NOTIFICATION_CATEGORIES.has(key as NotificationCategory) &&
            typeof value === 'boolean',
        ),
      );
      preference.categorySettings = {
        ...DEFAULT_CATEGORIES,
        ...preference.categorySettings,
        ...categoryPatch,
      };
    }
    if (patch.severitySettings) {
      const severityPatch = Object.fromEntries(
        Object.entries(patch.severitySettings).filter(
          ([key, value]) =>
            NOTIFICATION_SEVERITIES.has(key as NotificationSeverity) &&
            typeof value === 'boolean',
        ),
      );
      preference.severitySettings = {
        ...DEFAULT_SEVERITIES,
        ...preference.severitySettings,
        ...severityPatch,
        critical: true,
      };
    }
    return this.preferences.save(preference);
  }

  pushConfig() {
    return {
      configured: this.pushConfigured,
      publicKey: this.pushConfigured ? String(process.env.VAPID_PUBLIC_KEY) : null,
    };
  }

  async registerSubscription(
    recipientUserId: string,
    input: {
      endpoint: string;
      keys: { p256dh?: string; auth?: string };
      deviceLabel?: string;
      userAgent?: string;
    },
  ) {
    if (!this.pushConfigured) {
      throw new BadRequestException('Device push is not configured');
    }
    const endpoint = assertSafePushEndpoint(input.endpoint);
    if (
      typeof input.keys.p256dh !== 'string' ||
      typeof input.keys.auth !== 'string' ||
      !input.keys.p256dh ||
      !input.keys.auth ||
      input.keys.p256dh.length > 1_000 ||
      input.keys.auth.length > 1_000
    ) {
      throw new BadRequestException('Push subscription is incomplete');
    }
    const existing = await this.subscriptions.findOne({
      where: { endpoint },
    });
    if (existing && existing.recipientUserId !== recipientUserId) {
      throw new BadRequestException('Push subscription belongs to another user');
    }
    const row = existing || this.subscriptions.create({ endpoint });
    row.recipientUserId = recipientUserId;
    row.p256dhKey = input.keys.p256dh;
    row.authKey = input.keys.auth;
    row.deviceLabel = input.deviceLabel?.slice(0, 120) || null;
    row.userAgent = input.userAgent?.slice(0, 500) || null;
    row.active = true;
    row.revokedAt = null;
    row.failureCount = 0;
    await this.subscriptions.save(row);
    return { ok: true };
  }

  async removeSubscription(recipientUserId: string, endpoint: string) {
    await this.subscriptions.update(
      { recipientUserId, endpoint },
      { active: false, revokedAt: new Date() },
    );
    return { ok: true };
  }

  private isQuietHours(preference: AdminNotificationPreference) {
    if (!preference.quietHoursEnabled) return false;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: preference.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date());
      const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
      const now = hour * 60 + minute;
      const toMinutes = (value: string) => {
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
      };
      const start = toMinutes(preference.quietHoursStart);
      const end = toMinutes(preference.quietHoursEnd);
      return start <= end ? now >= start && now < end : now >= start || now < end;
    } catch {
      return false;
    }
  }

  private async deliverPush(
    notification: AdminNotification,
    preference: AdminNotificationPreference,
  ) {
    const categoryEnabled =
      notification.severity === 'critical' ||
      preference.categorySettings?.[notification.category] !== false;
    const severityEnabled =
      notification.severity === 'critical' ||
      preference.severitySettings?.[notification.severity] !== false;
    if (
      !this.pushConfigured ||
      !preference.pushEnabled ||
      !categoryEnabled ||
      !severityEnabled ||
      (notification.severity !== 'critical' && this.isQuietHours(preference))
    ) {
      notification.pushDeliveryStatus = 'skipped';
      await this.notifications.save(notification);
      return;
    }
    const subscriptions = await this.subscriptions.find({
      where: { recipientUserId: notification.recipientUserId, active: true },
    });
    if (!subscriptions.length) {
      notification.pushDeliveryStatus = 'skipped';
      await this.notifications.save(notification);
      return;
    }
    let sent = false;
    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
          },
          JSON.stringify({
            title: preference.privacyMode ? 'RealtyTechAI update' : notification.title,
            body: preference.privacyMode
              ? 'Open RealtyTechAI to view this update.'
              : notification.message,
            url: notification.actionUrl || '/login',
            tag: notification.incidentKey || notification.deduplicationKey,
            severity: notification.severity,
          }),
          { TTL: notification.severity === 'critical' ? 3600 : 900 },
        );
        subscription.lastSuccessAt = new Date();
        subscription.failureCount = 0;
        sent = true;
      } catch (error: any) {
        await this.recordSubscriptionFailure(subscription, Number(error?.statusCode));
        continue;
      }
      await this.subscriptions.save(subscription);
    }
    notification.pushAttemptCount += subscriptions.length;
    notification.pushDeliveryStatus = sent ? 'sent' : 'failed';
    notification.pushSentAt = sent ? new Date() : null;
    await this.notifications.save(notification);
  }

  /**
   * Render the email subject/text/html for a persisted notification. Template
   * notifications re-render from the stored template id + context; legacy
   * notifications fall back to the title/message with privacy-mode masking.
   */
  private renderEmailContent(
    notification: AdminNotification,
    preference: AdminNotificationPreference,
  ): { subject: string; text: string; html?: string } {
    if (notification.templateId) {
      const template = getTemplate(notification.templateId);
      let ctx: TemplateContext = {};
      try {
        const raw = notification.metadata?.[TEMPLATE_CONTEXT_METADATA_KEY];
        if (typeof raw === 'string' && raw) ctx = JSON.parse(raw);
      } catch {
        ctx = {};
      }
      if (notification.actionUrl && !ctx.actionPath) ctx = { ...ctx, actionPath: notification.actionUrl };
      if (template) {
        return {
          subject: template.subject(ctx),
          text: template.textBody(ctx),
          html: template.htmlBody(ctx),
        };
      }
    }
    const subject = preference.privacyMode
      ? 'RealtyTechAI update'
      : `[RealtyTechAI] [${notification.severity.toUpperCase()}] ${notification.title}`;
    const body = preference.privacyMode
      ? 'Open RealtyTechAI to view this update.'
      : notification.message;
    // Emails always carry the canonical absolute URL, never a raw path.
    const actionLine = notification.actionUrl
      ? `\n\nView in RealtyTechAI: ${canonicalActionUrl(notification.actionUrl)}`
      : '';
    return { subject, text: `${body}${actionLine}` };
  }

  private async deliverEmail(
    notification: AdminNotification,
    preference: AdminNotificationPreference,
  ) {
    const markSkipped = async () => {
      notification.emailDeliveryStatus = 'skipped';
      await this.notifications.save(notification);
    };
    // INFO events are in-app only by default — they never generate email.
    // Digest emails are the explicit exception: an opted-in digest is, by
    // definition, an email the user asked for.
    const isDigestEmail = (notification.templateId || '').startsWith('digest.');
    if (notification.severity === 'info' && !isDigestEmail) {
      await markSkipped();
      return;
    }
    // Critical alerts bypass category/severity opt-outs and quiet hours,
    // mirroring deliverPush. The emailEnabled master switch is always honored.
    // Opted-in digests bypass the severity toggle: dailyDigestEnabled is the
    // explicit opt-in for that email.
    const categoryEnabled =
      notification.severity === 'critical' ||
      preference.categorySettings?.[notification.category] !== false;
    const severityEnabled =
      notification.severity === 'critical' ||
      isDigestEmail ||
      preference.severitySettings?.[notification.severity] !== false;
    if (
      !preference.emailEnabled ||
      !categoryEnabled ||
      !severityEnabled ||
      (notification.severity !== 'critical' && this.isQuietHours(preference))
    ) {
      await markSkipped();
      return;
    }
    const recipient = await this.users.findOne({
      where: { id: notification.recipientUserId },
    });
    const toEmail = recipient?.email?.trim().toLowerCase();
    if (!toEmail || !recipient?.isActive || !recipient?.isEmailVerified) {
      await markSkipped();
      return;
    }
    notification.emailAttemptCount = (notification.emailAttemptCount || 0) + 1;
    try {
      const content = this.renderEmailContent(notification, preference);
      const result = await this.mailService.sendEmail({
        to: toEmail,
        subject: content.subject,
        text: content.text,
        ...(content.html ? { html: content.html } : {}),
      });
      notification.emailDeliveryStatus = 'sent';
      notification.emailSentAt = new Date();
      notification.providerMessageId = result?.messageId || null;
      notification.emailLastError = null;
      notification.emailRetryAt = null;
    } catch (error: unknown) {
      notification.emailDeliveryStatus = 'failed';
      notification.emailLastError = sanitizeProviderError(error);
      notification.emailRetryAt = null;
      this.logger.error(
        operationalEvent('notification_email_delivery_failed', {
          notificationId: notification.id,
          attempt: notification.emailAttemptCount,
          error: notification.emailLastError,
        }),
      );
      await this.notifications.save(notification);
      await this.scheduleEmailRetryOrEscalate(notification);
      return;
    }
    await this.notifications.save(notification);
  }

  /**
   * Bounded retry with exponential backoff after an email send failure. When
   * attempts are exhausted, an operations incident is raised (once) so the
   * failure is visible instead of silently dropped. The in-app notification
   * is always preserved regardless of email outcome.
   */
  private async scheduleEmailRetryOrEscalate(notification: AdminNotification) {
    if (notification.emailAttemptCount < EMAIL_MAX_ATTEMPTS && this.durableJobs) {
      const delayMinutes =
        EMAIL_RETRY_BACKOFF_MINUTES[notification.emailAttemptCount - 1] || 15;
      notification.emailRetryAt = new Date(Date.now() + delayMinutes * 60_000);
      await this.notifications.save(notification);
      try {
        await this.durableJobs.schedule({
          taskType: EMAIL_RETRY_TASK_TYPE,
          dedupeKey: `email-retry:${notification.id}`,
          payload: { notificationId: notification.id },
          nextRunAt: notification.emailRetryAt,
          maxAttempts: EMAIL_MAX_ATTEMPTS,
        });
      } catch (error: unknown) {
        this.logger.error(
          operationalEvent('notification_email_retry_schedule_failed', {
            notificationId: notification.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }
    if (notification.emailAttemptCount < EMAIL_MAX_ATTEMPTS) return;
    // Attempts exhausted. Raise one operations incident — but never for the
    // incident notification itself, to avoid unbounded regress.
    if (notification.eventType === 'notification.email_failed') return;
    await this.createForPlatform({
      eventType: 'notification.email_failed',
      category: 'system',
      severity: 'warning',
      audience: 'super_admin',
      title: 'Notification email delivery failed repeatedly',
      message:
        `Email delivery for notification "${notification.title}" failed after ` +
        `${notification.emailAttemptCount} attempts. Last error: ${notification.emailLastError || 'unknown'}. ` +
        `The in-app notification is preserved.`,
      deduplicationKey: `email-failed:${notification.id}`,
      incidentKey: `email-delivery:${notification.id}`,
      actionUrl: '/admin/dashboard',
      metadata: { notificationId: notification.id },
    });
  }

  async incidentIsOpen(incidentKey: string) {
    try {
      const latest = await this.notifications.findOne({
        where: { incidentKey },
        order: { createdAt: 'DESC' },
      });
      return Boolean(latest && !latest.eventType.endsWith('_recovered'));
    } catch {
      return false;
    }
  }

  private async recordSubscriptionFailure(
    subscription: AdminPushSubscription,
    statusCode?: number,
  ) {
    subscription.lastFailureAt = new Date();
    subscription.failureCount += 1;
    if ([404, 410].includes(Number(statusCode))) {
      subscription.active = false;
      subscription.revokedAt = new Date();
    }
    await this.subscriptions.save(subscription);
  }
}
