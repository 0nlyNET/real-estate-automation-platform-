# Appointment-provider controlled UAT

Automated tests use mocks and do not prove live OAuth, consent, invitations,
webhook delivery, account entitlements, or provider behavior. Complete this
matrix in the deployed production-like environment with synthetic leads and
accounts controlled by the test team. Email-only UAT is valid while Twilio/A2P
is unavailable.

## Evidence rules

Retain redacted tenant, test-run, lead, appointment, provider-event, invitee,
notification, durable-job, and CRM-delivery IDs with UTC timestamps and
screenshots. Never retain authorization codes, access or refresh tokens, client
secrets, callback tokens, webhook signing keys, or personal lead content.

## Common journey for the active provider

- [ ] Connect through **Connections** using the real provider consent screen.
- [ ] Choose the intended calendar or Calendly event type and run **Test
  connection**. Confirm it is the sole provider marked **Used for new
  bookings**.
- [ ] Receive and reply to a controlled inbound email; verify the AI remains
  blocked until the provider has confirmed availability and creation.
- [ ] Book one exact future time and verify one authoritative provider record,
  one internal appointment, `appointment_set`, the assigned-agent
  notification, and one accepted `appointment.created` CRM delivery.
- [ ] Replay the same booking key concurrently and verify no duplicate provider
  or internal record.
- [ ] Test a busy interval and a provider timeout/outage. Confirm no fake
  appointment and no “booked” claim; use the verified link or human handoff.
- [ ] Reschedule and cancel through every supported path. Verify
  `appointment.rescheduled` and `appointment.cancelled` delivery without
  rolling back the provider change during a CRM outage.
- [ ] Change the provider record externally and verify notification-driven
  reconciliation. Interrupt notifications and prove scheduled reconciliation
  repairs the same appointment.
- [ ] Revoke access and expire authorization. Confirm direct booking fails
  closed and the connection shows actionable recovery text.
- [ ] Switch the workspace default to another tested provider. Confirm new
  bookings use only the new provider while every old appointment still updates,
  reconciles, and cancels through its stored original provider.
- [ ] Repeat across a daylight-saving transition and require an explicit offset
  for ambiguous local time.
- [ ] Use **Take over** and verify queued AI/follow-up work stops immediately.

## Google Calendar evidence

- [ ] Writable-calendar selection and real FreeBusy result.
- [ ] Event ID, attendee invitation, ETag, and exact start/end match.
- [ ] Start-only, end-only, both-boundary, duration increase collision, and
  duration decrease reschedules; provider-side manually added attendees remain.
- [ ] Stale ETag reconciles only that appointment and does not block an unrelated
  new booking.
- [ ] Watch-channel notification, renewal, duplicate delivery, event re-fetch,
  external deletion/cancellation, and scheduled fallback.

## Microsoft Outlook and Teams evidence

- [ ] Organizational Microsoft 365 OAuth, writable-calendar selection,
  `getSchedule`, and selected-calendar view agree on availability.
- [ ] Real Outlook event, lead invitation, event version, and exact times match.
- [ ] A virtual appointment returns a working Microsoft Teams join URL; an
  in-person or phone appointment does not create Teams by default.
- [ ] Timing patches preserve attendees and Teams metadata; a version conflict
  reconciles only that appointment.
- [ ] Graph validation handshake, `clientState`, renewal, lifecycle/missed
  recovery, duplicate delivery, event re-fetch, external reschedule/deletion,
  and scheduled fallback.

## Calendly evidence

- [ ] OAuth scopes, eligible paid plan, active event-type selection, duration,
  location, buffers, and availability rules are reflected by the API.
- [ ] Scheduling API creates one event/invitee with working invitee email and
  trusted cancel/reschedule links.
- [ ] Direct booking failure falls back to the verified scheduling link or human
  handoff without an internal confirmed appointment.
- [ ] Cancel through the API and reschedule through the verified Calendly link.
  Confirm paired `invitee.canceled`/`invitee.created` payloads rebind the same
  internal appointment instead of creating a duplicate.
- [ ] Verify timestamped HMAC signature rejection, callback-token rejection,
  replay/duplicate handling, wrong-tenant isolation, authoritative re-fetch,
  and scheduled fallback.
- [ ] Force refresh-token rotation and confirm the previous refresh token is
  never reused.

Do not activate a real client until the selected provider's complete section
and the common journey pass with retained evidence.
