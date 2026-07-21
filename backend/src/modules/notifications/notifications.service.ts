import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as webPush from 'web-push';
import { platformAdminEmails, platformStaffEmails, resolvePlatformRole } from '../../common/env';
import { operationalEvent } from '../../common/operational-log';
import { User } from '../users/user.entity';
import {
  AdminNotification,
  NotificationCategory,
  NotificationSeverity,
} from './notification.entity';
import { AdminNotificationPreference } from './notification-preference.entity';
import { AdminPushSubscription } from './push-subscription.entity';

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

@Injectable()
export class NotificationsService {
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
      return this.createForRecipients(input, actionUrl, recipientIds);
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
      const recipientIds = tenantUsers
        .filter((user) => {
          if (user.role === 'read_only') return false;
          if (!input.assignedUserId) return user.role === 'owner' || user.role === 'admin';
          return (
            user.id === input.assignedUserId ||
            user.role === 'owner' ||
            user.role === 'admin'
          );
        })
        .map((user) => user.id);
      return this.createForRecipients(input, actionUrl, [...new Set(recipientIds)]);
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
    const created: AdminNotification[] = [];
    for (const recipientUserId of recipientIds) {
      const preference = await this.getPreferences(recipientUserId);
      if (!preference.inAppEnabled && !preference.pushEnabled) continue;
      let notification = await this.notifications.findOne({
        where: {
          recipientUserId,
          deduplicationKey: input.deduplicationKey,
        },
      });
      if (notification) continue;
      try {
        notification = await this.notifications.save(
          this.notifications.create({
            recipientUserId,
            eventType: input.eventType,
            category: input.category,
            severity: input.severity,
            title: input.title.slice(0, 180),
            message: input.message.slice(0, 2000),
            actionUrl,
            entityType: input.entityType || null,
            entityId: input.entityId || null,
            deduplicationKey: input.deduplicationKey.slice(0, 255),
            incidentKey: input.incidentKey?.slice(0, 255) || null,
            metadata: input.metadata || {},
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          }),
        );
      } catch (error: any) {
        if (String(error?.code || '') === '23505') continue;
        throw error;
      }
      created.push(notification);
      await this.deliverPush(notification, preference);
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
    if (!row) return { ok: false };
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
      preference = await this.preferences.save(
        this.preferences.create({
          recipientUserId,
          inAppEnabled: true,
          pushEnabled: true,
          emailEnabled: false,
          privacyMode: true,
          categorySettings: DEFAULT_CATEGORIES,
          severitySettings: DEFAULT_SEVERITIES,
          quietHoursEnabled: false,
          quietHoursStart: '21:00',
          quietHoursEnd: '08:00',
          timezone: 'America/New_York',
        }),
      );
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
    let endpoint: URL;
    try {
      endpoint = new URL(input.endpoint);
    } catch {
      throw new BadRequestException('Invalid push subscription endpoint');
    }
    if (
      endpoint.protocol !== 'https:' ||
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
      where: { endpoint: input.endpoint },
    });
    if (existing && existing.recipientUserId !== recipientUserId) {
      throw new BadRequestException('Push subscription belongs to another user');
    }
    const row = existing || this.subscriptions.create({ endpoint: input.endpoint });
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
