# Google Calendar production setup

This checklist contains only deployment-owner work outside the RealtyTechAI
codebase. Clients never enter Google developer credentials.

## External checklist

- [ ] Use the production Google Cloud project and enable the Google Calendar
  API.
- [ ] Configure the OAuth consent screen with the production application name,
  support contact, authorized domains, privacy policy, and terms URL.
- [ ] Request exactly these scopes:
  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
  - `https://www.googleapis.com/auth/calendar.freebusy`
  - `https://www.googleapis.com/auth/calendar.events`
- [ ] Create an OAuth 2.0 **Web application** client and register the exact
  HTTPS redirect URI
  `<PUBLIC_API_URL>/calendar/google/oauth/callback`.
- [ ] Store the OAuth values only in backend production secrets as
  `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.
- [ ] Make `<PUBLIC_API_URL>/calendar/google/notifications` publicly reachable
  over HTTPS. Set `GOOGLE_CALENDAR_WEBHOOK_URL` only when the callback must use
  a different public HTTPS URL.
- [ ] Keep `INTEGRATIONS_ENCRYPTION_KEY` stable and backed up. Rotating it
  requires a reviewed credential migration or every connected workspace to
  reconnect.
- [ ] Add controlled-UAT Google accounts as consent-screen test users until the
  app is published.
- [ ] Complete Google's production publishing, sensitive-scope verification,
  domain verification, and branding review when required for non-test users.
- [ ] Confirm the production hosting platform preserves the callback paths and
  does not cache or redirect notification POST requests.

Official references:

- [Google Calendar authorization](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Events watch endpoint](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch)

None of the unchecked items above is proven by repository tests. Complete them
in the deployed environment before provider UAT.
