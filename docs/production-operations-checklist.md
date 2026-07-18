# RealtyTechAI production operations checklist

Complete every **Required before onboarding** item before giving a client access. Record the date, operator, and evidence link for each check. Never paste secrets into this document or a support ticket.

## Required before onboarding

### Application and database

- [ ] `GET https://real-estate-automation-platform-production.up.railway.app/ready` returns HTTP 200 with `database.status` and `schema.status` both `up`, and both missing counts equal to zero.
- [ ] Railway runs the backend from the repository root configuration and the latest `main` commit is healthy.
- [ ] Railway PostgreSQL backups are enabled on a schedule appropriate for client data.
- [ ] A restore drill has been completed into a non-production database and the restored app passes `/ready`.
- [ ] Railway service alerts have a monitored recipient and cover deployment failure, crashes, and sustained resource pressure.
- [ ] `JWT_SECRET` is unique and at least 32 random characters; `INTEGRATIONS_ENCRYPTION_KEY` is a base64-encoded 32-byte key.
- [ ] `TYPEORM_SYNC=false`, `NODE_ENV=production`, and `GLOBAL_AUTOMATIONS_DISABLED=false` unless automation is intentionally paused.

### System email and operator delivery

- [ ] `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and `SENDGRID_FROM_NAME` are configured in Railway.
- [ ] The SendGrid sender/domain is authenticated and a real verification email arrives outside the sending domain.
- [ ] `SALES_INBOX_EMAIL` is a monitored operator mailbox.
- [ ] Submit the public contact form and an authenticated support ticket; confirm both reach that mailbox.
- [ ] Invite a test team member; confirm the verification email arrives and its link opens the production frontend.

### Twilio SMS

- [ ] Global Twilio variables are configured, or the client has saved tenant-specific credentials under Integrations.
- [ ] The Twilio phone number's inbound messaging webhook is an HTTP POST to `https://real-estate-automation-platform-production.up.railway.app/webhooks/twilio/inbound`.
- [ ] `TWILIO_WEBHOOK_URL` exactly matches that public URL. This exact match is used for signature verification.
- [ ] Send one outbound SMS and reply to it. Confirm the outbound and inbound events appear on the correct lead and workspace only.
- [ ] Confirm opt-out language is present and a STOP reply prevents further automated SMS.

### Facebook Lead Ads

- [ ] `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URL`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN`, and an active `FACEBOOK_GRAPH_API_VERSION` are configured.
- [ ] The OAuth redirect is `https://real-estate-automation-platform-production.up.railway.app/integrations/facebook/callback`.
- [ ] The Page webhook callback is `https://real-estate-automation-platform-production.up.railway.app/webhooks/facebook/lead-ads` and uses the same verify token as Railway.
- [ ] Connect the client Page in Integrations and confirm the selected Page reports connected.
- [ ] Submit a Meta test lead. Confirm it creates exactly one lead in the correct workspace, assigns it as configured, and starts only the intended active sequence.

### Stripe billing

- [ ] `STRIPE_SECRET_KEY`, all four `STRIPE_PRICE_*` IDs, and `STRIPE_WEBHOOK_SECRET` are configured for the same Stripe mode.
- [ ] Stripe sends events to `https://real-estate-automation-platform-production.up.railway.app/billing/webhook`.
- [ ] Complete a test-mode checkout and confirm the workspace plan changes only after the signed webhook is processed.
- [ ] Open the billing portal and test cancellation/plan-change behavior before switching to live keys.

### Client acceptance test

- [ ] Create a fresh client workspace through the platform-admin onboarding flow.
- [ ] Verify the owner email, sign in, finish the dashboard checklist, and set timezone, quiet hours, booking link, and automation state.
- [ ] Create/import one lead, assign it, add a note, change its stage, and confirm reporting updates.
- [ ] Install one template inactive, review every step, activate it, and verify its first real delivery with a test contact owned by the client.
- [ ] Confirm an agent cannot access another workspace or admin-only settings.
- [ ] Export workspace data and inspect it for expected business records and absence of credentials/secrets.

## Recurring controls

### Weekly

- Review failed Railway deployments, crashes, schema readiness, and provider delivery errors.
- Review open support and deletion-request tickets; record ownership and resolution.
- Check SendGrid/Twilio/Meta/Stripe dashboards for delivery or webhook failures.

### Monthly

- Restore the newest backup into a non-production database and run readiness plus a login/lead smoke test.
- Review platform-admin membership, provider users, webhook endpoints, and least-privilege access.
- Test one client journey from lead capture through assignment, follow-up, reporting, export, and support.

### Quarterly

- Rotate credentials according to provider policy and immediately test every affected integration.
- Review retention, deletion requests, privacy terms, opt-out behavior, and incident contacts with the business owner.

## Incident stop conditions

Pause onboarding and set `GLOBAL_AUTOMATIONS_DISABLED=true` when tenant isolation, schema readiness, incorrect-recipient messaging, webhook authenticity, or opt-out enforcement is uncertain. Resume only after the cause is identified, the fix is tested, and a production smoke test succeeds.
