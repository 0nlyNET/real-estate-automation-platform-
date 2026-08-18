import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import {
  BookingProviderAdapter,
  BookingProviderName,
  StoredBookingProvider,
  providerNameFromStored,
} from './booking-provider.types';
import { CalendlyService } from './calendly.service';
import { GoogleBookingProviderAdapter } from './google-booking-provider.adapter';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

@Injectable()
export class BookingProviderRegistry {
  private readonly adapters: Map<BookingProviderName, BookingProviderAdapter>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
    private readonly google: GoogleBookingProviderAdapter,
    private readonly microsoft: MicrosoftCalendarService,
    private readonly calendly: CalendlyService,
    @Optional() private readonly audit?: AuditService,
  ) {
    this.adapters = new Map<BookingProviderName, BookingProviderAdapter>([
      [google.name, google],
      [microsoft.name, microsoft],
      [calendly.name, calendly],
    ]);
  }

  adapter(provider: BookingProviderName) {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new ConflictException({
        code: 'BOOKING_PROVIDER_UNSUPPORTED',
        message: 'That booking provider is not supported.',
      });
    }
    return adapter;
  }

  forStoredProvider(provider: StoredBookingProvider) {
    return this.adapter(providerNameFromStored(provider));
  }

  async active(tenantId: string) {
    const settings = await this.settings.findOne({ where: { tenantId } });
    if (settings?.activeBookingProvider) {
      return this.adapter(settings.activeBookingProvider);
    }
    // Backward compatibility for workspaces already using the PR #51 Google
    // implementation before the active-provider column is deployed/backfilled.
    const googleStatus = await this.google.status(tenantId);
    if (googleStatus.connected) return this.google;
    throw new ConflictException({
      code: 'BOOKING_PROVIDER_NOT_SELECTED',
      message:
        'Choose one connected appointment provider for new bookings. RealtyTechAI will not switch providers automatically.',
    });
  }

  async setActive(
    tenantId: string,
    provider: BookingProviderName,
    actorId: string,
  ) {
    const adapter = this.adapter(provider);
    const status = await adapter.status(tenantId);
    if (!status.connected) {
      throw new ConflictException({
        code: 'BOOKING_PROVIDER_NOT_READY',
        message:
          'Connect, choose, and test that provider before using it for new bookings.',
      });
    }
    let settings = await this.settings.findOne({ where: { tenantId } });
    if (!settings) {
      settings = this.settings.create({
        tenantId,
        timeZone: 'America/New_York',
        quietHoursStart: '21:00',
        quietHoursEnd: '08:00',
        automationsEnabled: false,
        roundRobinEnabled: false,
        bookingLinkVerificationStatus: 'unverified',
      });
    }
    const previous = settings.activeBookingProvider || null;
    settings.activeBookingProvider = provider;
    await this.settings.save(settings);
    await this.audit?.record({
      tenantId,
      actorId,
      action: 'calendar.active_provider_changed',
      resourceType: 'tenant',
      resourceId: tenantId,
      method: 'PUT',
      path: '/calendar/active',
      statusCode: 200,
      metadata: { previousProvider: previous, provider },
    });
    return this.status(tenantId);
  }

  async status(tenantId: string) {
    const [settings, google, microsoft, calendly] = await Promise.all([
      this.settings.findOne({ where: { tenantId } }),
      this.google.status(tenantId),
      this.microsoft.status(tenantId),
      this.calendly.status(tenantId),
    ]);
    const providers = { google_calendar: google, microsoft_calendar: microsoft, calendly };
    const activeProvider =
      settings?.activeBookingProvider || (google.connected ? 'google_calendar' : null);
    const activeStatus = activeProvider ? providers[activeProvider] : null;
    const noActiveIssue = {
      what: 'No appointment provider is selected for new bookings.',
      why: 'Availability and creation must use the same authoritative provider.',
      how: 'Connect and test a provider, then select Use for new bookings.',
    };
    return {
      activeProvider,
      connected: activeStatus?.connected === true,
      status: activeStatus?.status || 'disconnected',
      selectedResource: activeStatus?.selectedResource || null,
      selectedCalendar: activeStatus?.selectedResource || null,
      lastTestedAt: activeStatus?.lastTestedAt || null,
      lastSuccessfulSyncAt: activeStatus?.lastSuccessfulSyncAt || null,
      issue: activeStatus?.issue || noActiveIssue,
      providers,
    };
  }

  withTenantBookingLock<T>(
    provider: BookingProviderName,
    tenantId: string,
    callback: () => Promise<T>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `booking-provider:${provider}:${tenantId}`,
      ]);
      return callback();
    });
  }
}
