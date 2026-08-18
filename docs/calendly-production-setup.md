# Calendly production setup

This checklist contains only deployment-owner work outside the RealtyTechAI
codebase. Clients authorize Calendly through OAuth; they never paste personal
access tokens or developer credentials into RealtyTechAI.

## External checklist

- [ ] Create a **Web / Production** OAuth application in the Calendly Developer
  Portal; do not use a Sandbox application for customer data.
- [ ] Register the exact HTTPS redirect URI
  `<PUBLIC_API_URL>/calendar/calendly/oauth/callback`.
- [ ] Configure these scopes:
  - `users:read`
  - `event_types:read`
  - `scheduled_events:write`
  - `webhooks:write`

  Calendly documents that `scheduled_events:write` includes read access for
  the same domain, so a separate `scheduled_events:read` grant is unnecessary.
- [ ] Confirm the application uses its one specific redirect URI. RealtyTechAI's
  authorization flow supplies PKCE with the S256 challenge method required by
  Calendly's current OAuth guidance.
- [ ] Store the OAuth values only in backend production secrets as
  `CALENDLY_CLIENT_ID` and `CALENDLY_CLIENT_SECRET`.
- [ ] Copy the OAuth application's webhook signing key when Calendly displays
  it and store it only as the backend secret
  `CALENDLY_WEBHOOK_SIGNING_KEY`.
- [ ] Make `<PUBLIC_API_URL>/calendar/calendly/notifications` publicly reachable
  over HTTPS. Set `CALENDLY_WEBHOOK_URL` only when the callback must use a
  different public HTTPS URL.
- [ ] Use an eligible paid Calendly plan/account for the Scheduling API direct
  booking flow and user-scoped webhook subscriptions.
- [ ] Configure at least one active event type whose duration, locations,
  buffers, schedule, and booking rules match the intended client workflow.
- [ ] Retain an owner for OAuth credential rotation and webhook-signing-key
  recovery. Calendly refresh tokens rotate and must not be reused.

Official references:

- [Create a Calendly OAuth app](https://developer.calendly.com/creating-an-oauth-app)
- [Calendly OAuth scopes](https://developer.calendly.com/scopes)
- [Schedule events with the API](https://developer.calendly.com/schedule-events-with-ai-agents)
- [Webhook signatures](https://developer.calendly.com/api-docs/4c305798a61d3-webhook-signatures)
- [Refresh-token rotation](https://developer.calendly.com/refresh-token-rotation-guide)

None of the unchecked items above is proven by repository tests. Complete them
in the deployed environment before provider UAT.
