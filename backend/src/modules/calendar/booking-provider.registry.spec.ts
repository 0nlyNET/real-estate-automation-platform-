import { ConflictException } from '@nestjs/common';
import { BookingProviderRegistry } from './booking-provider.registry';
import {
  BookingProviderName,
  StoredBookingProvider,
} from './booking-provider.types';

function adapter(
  name: BookingProviderName,
  storedProvider: StoredBookingProvider,
  connected = true,
) {
  return {
    name,
    storedProvider,
    status: jest.fn().mockResolvedValue({
      provider: name,
      status: connected ? 'connected' : 'disconnected',
      connected,
      selectedResource: connected
        ? { id: `${name}-resource`, name, timeZone: 'UTC', type: 'calendar' }
        : null,
      lastTestedAt: connected ? new Date() : null,
      lastSuccessfulSyncAt: connected ? new Date() : null,
      changeNotifications: { status: 'active', expiresAt: null },
      capabilities: {
        directBooking: true,
        automatedReschedule: true,
        cancellation: true,
        onlineMeeting: name === 'microsoft_calendar',
        changeNotifications: true,
      },
      issue: null,
    }),
    readyBinding: jest.fn(),
    checkAvailability: jest.fn(),
    createAppointment: jest.fn(),
    getAppointment: jest.fn(),
    updateAppointment: jest.fn(),
    cancelAppointment: jest.fn(),
  };
}

describe('BookingProviderRegistry', () => {
  function fixture(activeBookingProvider: BookingProviderName | null = null) {
    const row: any = activeBookingProvider
      ? { tenantId: 'tenant-1', activeBookingProvider }
      : null;
    const settings = {
      findOne: jest.fn().mockImplementation(async () => row),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        Object.assign(row || {}, value);
        return value;
      }),
    };
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const google = adapter('google_calendar', 'google');
    const microsoft = adapter('microsoft_calendar', 'microsoft');
    const calendly = adapter('calendly', 'calendly');
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const registry = new BookingProviderRegistry(
      dataSource as any,
      settings as any,
      google as any,
      microsoft as any,
      calendly as any,
      audit as any,
    );
    return {
      registry,
      settings,
      google,
      microsoft,
      calendly,
      audit,
      dataSource,
      manager,
    };
  }

  it('resolves only the explicitly active provider for new bookings', async () => {
    const item = fixture('microsoft_calendar');
    await expect(item.registry.active('tenant-1')).resolves.toBe(
      item.microsoft,
    );
    expect(item.google.status).not.toHaveBeenCalled();
  });

  it('keeps a legacy tested Google workspace usable until active-provider backfill', async () => {
    const item = fixture();
    await expect(item.registry.active('tenant-1')).resolves.toBe(item.google);
    expect(item.google.status).toHaveBeenCalledWith('tenant-1');
  });

  it('fails closed instead of silently falling back when no provider is ready', async () => {
    const item = fixture();
    item.google.status.mockResolvedValue({ connected: false });
    await expect(item.registry.active('tenant-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'BOOKING_PROVIDER_NOT_SELECTED',
      }),
    });
  });

  it('does not activate an untested provider', async () => {
    const item = fixture('google_calendar');
    item.calendly.status.mockResolvedValue({
      connected: false,
      status: 'configured',
    });
    await expect(
      item.registry.setActive('tenant-1', 'calendly', 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(item.settings.save).not.toHaveBeenCalled();
  });

  it('switches only the default while provider-bound appointments still resolve their original adapter', async () => {
    const item = fixture('google_calendar');
    await item.registry.setActive(
      'tenant-1',
      'microsoft_calendar',
      'actor-1',
    );
    expect(item.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ activeBookingProvider: 'microsoft_calendar' }),
    );
    expect(item.registry.forStoredProvider('google')).toBe(item.google);
    expect(item.registry.forStoredProvider('microsoft')).toBe(item.microsoft);
    expect(item.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          previousProvider: 'google_calendar',
          provider: 'microsoft_calendar',
        },
      }),
    );
  });

  it('serializes booking by provider and tenant with a transaction-scoped lock', async () => {
    const item = fixture('calendly');
    const callback = jest.fn().mockResolvedValue('done');
    await expect(
      item.registry.withTenantBookingLock(
        'calendly',
        'tenant-1',
        callback,
      ),
    ).resolves.toBe('done');
    expect(item.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['booking-provider:calendly:tenant-1'],
    );
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
