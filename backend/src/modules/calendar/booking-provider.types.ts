export type BookingProviderName =
  | 'google_calendar'
  | 'microsoft_calendar'
  | 'calendly';

export type StoredBookingProvider = 'google' | 'microsoft' | 'calendly';

export type AppointmentMode = 'in_person' | 'phone' | 'virtual';

export type ProviderConnectionStatus =
  | 'disconnected'
  | 'choose_resource'
  | 'configured'
  | 'connected'
  | 'needs_attention';

export type ProviderAppointment = {
  provider: BookingProviderName;
  storedProvider: StoredBookingProvider;
  connectionId: string;
  resourceId: string;
  id: string;
  inviteeId: string | null;
  version: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  joinUrl: string | null;
  cancelUrl: string | null;
  rescheduleUrl: string | null;
  providerUpdatedAt: Date | null;
};

export type ProviderBinding = {
  provider: BookingProviderName;
  storedProvider: StoredBookingProvider;
  connectionId: string;
  resourceId: string;
  resourceName: string;
  timeZone: string;
};

export type ProviderStatus = {
  provider: BookingProviderName;
  status: ProviderConnectionStatus;
  connected: boolean;
  selectedResource: {
    id: string;
    name: string;
    timeZone: string | null;
    type: string;
  } | null;
  lastTestedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  changeNotifications: {
    status: 'active' | 'reconciliation_only' | 'not_supported';
    expiresAt: Date | null;
  };
  capabilities: {
    directBooking: boolean;
    automatedReschedule: boolean;
    cancellation: boolean;
    onlineMeeting: boolean;
    changeNotifications: boolean;
  };
  issue: { what: string; why: string; how: string } | null;
};

export type CreateProviderAppointmentInput = {
  tenantId: string;
  resourceId?: string;
  leadId: string;
  start: Date;
  end: Date;
  timeZone: string;
  summary: string;
  description: string;
  attendeeName: string;
  attendeeEmail?: string | null;
  idempotencyKey: string;
  mode: AppointmentMode;
};

export type UpdateProviderAppointmentInput = {
  tenantId: string;
  eventId: string;
  inviteeId?: string | null;
  resourceId?: string | null;
  version?: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  mode: AppointmentMode;
};

export type CancelProviderAppointmentInput = {
  tenantId: string;
  eventId: string;
  inviteeId?: string | null;
  resourceId?: string | null;
  version?: string | null;
};

export interface BookingProviderAdapter {
  readonly name: BookingProviderName;
  readonly storedProvider: StoredBookingProvider;
  status(tenantId: string): Promise<ProviderStatus>;
  readyBinding(tenantId: string): Promise<ProviderBinding>;
  checkAvailability(
    tenantId: string,
    start: Date,
    end: Date,
    excludeEventId?: string | null,
    resourceId?: string | null,
  ): Promise<{ available: boolean; checkedAt: Date; timeZone: string | null }>;
  createAppointment(
    input: CreateProviderAppointmentInput,
  ): Promise<ProviderAppointment>;
  getAppointment(
    tenantId: string,
    eventId: string,
    resourceId?: string | null,
    inviteeId?: string | null,
  ): Promise<ProviderAppointment | null>;
  updateAppointment(
    input: UpdateProviderAppointmentInput,
  ): Promise<ProviderAppointment>;
  cancelAppointment(
    input: CancelProviderAppointmentInput,
  ): Promise<{ cancelled: true }>;
}

export function providerNameFromStored(
  provider: StoredBookingProvider,
): BookingProviderName {
  return provider === 'google'
    ? 'google_calendar'
    : provider === 'microsoft'
      ? 'microsoft_calendar'
      : 'calendly';
}

export function storedProviderFromName(
  provider: BookingProviderName,
): StoredBookingProvider {
  return provider === 'google_calendar'
    ? 'google'
    : provider === 'microsoft_calendar'
      ? 'microsoft'
      : 'calendly';
}
