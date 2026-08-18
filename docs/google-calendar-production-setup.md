# Google Calendar production setup

RealtyTechAI owns one Google OAuth web application. Clients never enter API
credentials. They authorize their Google account, choose one writable calendar,
and run the connection test.

## Owner setup

1. In the production Google Cloud project, enable the Google Calendar API.
2. Configure the OAuth consent screen and request only:
   - `calendar.calendarlist.readonly`
   - `calendar.freebusy`
   - `calendar.events`
3. Create a Web application OAuth client. Register exactly
   `<PUBLIC_API_URL>/calendar/google/oauth/callback`; production must use HTTPS.
4. Save the client ID and secret only as backend secrets named
   `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.
5. Make `<PUBLIC_API_URL>/calendar/google/notifications` publicly reachable over
   HTTPS for Google event-change notifications. Set
   `GOOGLE_CALENDAR_WEBHOOK_URL` only if that exact callback must use a different
   public HTTPS URL. No webhook secret is pasted into Google: RealtyTechAI creates
   a unique channel token, stores only its SHA-256 hash, validates the channel,
   resource, token, and monotonic message number, and then re-fetches events.
6. Keep `INTEGRATIONS_ENCRYPTION_KEY` stable and backed up. It encrypts refresh
   and access tokens at rest; rotating it requires a reviewed token migration or
   every client reconnecting.
7. Apply the registered database migration before exposing Connect Google
   Calendar.

## Client workflow

Connections → Connect Google Calendar → approve access → choose the intended
writable calendar → Test connection. Only a tested connection displays
**Connected**. The UI displays What / Why / How to fix for every blocker.

## Controlled UAT

Use a synthetic lead with an email address and a calendar controlled by the
test team. Start an email-only test run if SMS/A2P is unavailable, then:

1. Receive the first email, reply, and verify the inbound message and AI reply.
2. Agree to one exact future time in the workspace time zone.
3. Verify the availability check, one Google event, attendee invitation, one
   RealtyTechAI appointment, `appointment_set`, assigned-agent notification,
   and one durable `appointment.created` CRM delivery.
4. Retry the same booking request and verify there is still one event and one
   appointment.
5. Reschedule start-only, end-only, and both start/end; verify manually added
   Google attendees remain present. Then cancel and verify both systems match.
6. Revoke Google access and confirm booking stops with a handoff or verified
   external link; no internal scheduled appointment may be created.
7. Repeat across a daylight-saving transition. Nonexistent and ambiguous local
   wall times must be rejected unless an explicit UTC offset resolves them.
8. Modify the event directly in Google and verify the signed push notification
   triggers prompt reconciliation. Also verify scheduled reconciliation still
   repairs the appointment if notification delivery is interrupted.
9. Use **Take over** and verify queued AI work and follow-up stop immediately.

Retain only redacted IDs, timestamps, screenshots, and pass/fail evidence. Never
copy OAuth codes, tokens, client secrets, message bodies containing personal
data, or webhook signing secrets into evidence.

Do not activate a real client from automated tests alone. Google consent-screen
approval, real OAuth, real invite delivery, provider outage recovery, the full
controlled journey above, and reconciliation after an external calendar edit
must all be observed in the deployed environment.
