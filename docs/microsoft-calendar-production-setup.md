# Microsoft Outlook and Teams production setup

This checklist contains only deployment-owner work outside the RealtyTechAI
codebase. It targets Microsoft 365 work or school accounts because the Graph
`getSchedule` delegated flow used for authoritative availability does not
support personal Microsoft accounts.

## External checklist

- [ ] Create a Microsoft Entra app registration for **Accounts in any
  organizational directory** (multitenant).
- [ ] Under Web platform authentication, register the exact HTTPS redirect URI
  `<PUBLIC_API_URL>/calendar/microsoft/oauth/callback`.
- [ ] Add these delegated permissions/scopes:
  - `openid`
  - `profile`
  - `offline_access`
  - `User.Read`
  - `Calendars.ReadWrite`
- [ ] Do not add application permissions. RealtyTechAI acts only as the
  authenticated Microsoft 365 user.
- [ ] Create a production client secret with an owned expiry/rotation reminder.
  Store the values only in backend production secrets as
  `MICROSOFT_CALENDAR_CLIENT_ID` and
  `MICROSOFT_CALENDAR_CLIENT_SECRET`.
- [ ] Make `<PUBLIC_API_URL>/calendar/microsoft/notifications` publicly
  reachable over HTTPS for Graph validation, event notifications, and lifecycle
  notifications. Set `MICROSOFT_CALENDAR_WEBHOOK_URL` only when the callback
  must use a different public HTTPS URL.
- [ ] Ensure the intended Microsoft 365 users have Exchange Online mailboxes
  and can create events in the calendars they will select.
- [ ] Ensure any calendar used for virtual appointments allows
  `teamsForBusiness` online meetings and that the user is licensed for Teams.
- [ ] Grant tenant consent where the customer's Entra policy requires it.
- [ ] Complete publisher verification and multitenant consent/branding review
  if required by Microsoft or customer tenant policy.
- [ ] Configure secret-expiry monitoring and an owner for Entra consent or
  conditional-access failures.

Official references:

- [Microsoft identity authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Graph getSchedule](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0)
- [Create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)
- [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)
- [Subscription resource and lifetimes](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)

None of the unchecked items above is proven by repository tests. Complete them
in the deployed environment before provider UAT.
