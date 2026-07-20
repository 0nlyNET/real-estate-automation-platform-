# RealtyTechAI

RealtyTechAI is a multi-tenant lead-response and follow-up platform for real estate teams. The repository contains a Next.js web application and a NestJS/PostgreSQL API.

## What is implemented

- Tenant-scoped leads, users, teams, assignments, messaging, and reporting
- HttpOnly-cookie JWT authentication, session revocation, verified accounts, password reset, forced temporary-password replacement, role checks, and platform-admin allow-listing
- SMS/email provider credentials encrypted at rest
- Twilio inbound signature verification, opt-outs, quiet hours, and follow-up sequence controls
- One flat managed-service checkout, Stripe billing portal, duplicate-subscription prevention, signed/idempotent webhooks, and centralized entitlement checks
- Fixed-user and round-robin lead routing without client-facing plan gates
- Persisted public applications, structured onboarding/readiness, a platform operations queue, and protected lead intake with consent evidence
- A role-aware owner/staff operating dashboard with real billing summaries, assignments, read-only communications, and 90-day diagnostic retention
- In-app notifications and standards-based web push for trusted lead, client, support, billing, integration, and health events

Provider accounts and production infrastructure are not included. Results, uptime, certifications, and legal compliance depend on the deployment and operating process.

## Repository layout

- `frontend/` — Next.js 16 application, including the tenant and platform-admin interfaces
- `backend/` — NestJS 11 API and TypeORM entities
- `docker-compose.yml` — local PostgreSQL, API, and web stack
- `.github/workflows/ci.yml` — build, test, and dependency-audit checks
- `admin-ui/` — archived prototype; the active admin interface is in `frontend/app/admin`

## Run locally with Docker

Requirements: Docker with Compose.

1. Create a root `.env` with at least:

   ```dotenv
   JWT_SECRET=replace-with-at-least-32-random-characters
   INTEGRATIONS_ENCRYPTION_KEY=replace-with-base64-of-32-random-bytes
   ```

   Generate values with `openssl rand -hex 32` and `openssl rand -base64 32`.

2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:3000`. API liveness is `http://localhost:4000/health/live`; full readiness is `http://localhost:4000/health/readiness`.

To create the first verified owner, add `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to the root `.env`, then run `docker compose exec backend npm run seed`. Add the same email to `PLATFORM_ADMIN_EMAILS` only if that account should manage every tenant.

The local Compose stack enables TypeORM schema synchronization for an empty development database. Do not enable `TYPEORM_SYNC` in production.

## Run without Docker

Requirements: Node.js 22 and PostgreSQL 15 or newer.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

cd backend
npm ci
npm run build
npm run start:dev
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

For a disposable, empty local database, `TYPEORM_SYNC=true` is supported. Use reviewed migrations with `TYPEORM_SYNC=false` for every production schema change.

After building the backend, `npm run seed` creates the initial verified owner from the explicit `SEED_ADMIN_*` environment values.

## Production configuration

See `backend/.env.example` and `frontend/.env.example`. At minimum, configure:

- a strong `JWT_SECRET` and comma-separated `PLATFORM_ADMIN_EMAILS`
- PostgreSQL through `DATABASE_URL`
- a 32-byte `INTEGRATIONS_ENCRYPTION_KEY`
- backend `FRONTEND_URL` and `PUBLIC_APP_URL`, both set to the canonical frontend HTTPS origin
- frontend server-only `BACKEND_API_URL` for the same-origin `/api/backend/*` proxy, plus `NEXT_PUBLIC_SITE_URL` for canonical metadata; do not expose the backend origin through `NEXT_PUBLIC_*`
- exact public `TWILIO_WEBHOOK_URL=<api-origin>/webhooks/twilio/inbound` and `TWILIO_STATUS_CALLBACK_URL=<api-origin>/webhooks/twilio/status`
- Meta app credentials, an active `FACEBOOK_GRAPH_API_VERSION`, and the exact
  `FACEBOOK_WEBHOOK_URL` only when Facebook Lead Ads is enabled
- SendGrid, Twilio, Stripe, and Facebook values only for integrations you enable
- `SALES_INBOX_EMAIL` for public contact/application delivery
- `STRIPE_PRICE_SERVICE_MONTH` plus matching Stripe secret/webhook values when billing is enabled
- one VAPID key pair (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`) for admin phone alerts
- `OPERATIONAL_RETENTION_DAYS=90` unless a reviewed 30–365 day policy is required

Production startup validates critical security/database configuration, and `/health/readiness` checks the database, schema, pending migrations, system email, billing configuration, worker mode, encryption, and legacy plaintext credential count without exposing secrets. Terminate HTTPS at the hosting platform, restrict database access, run migrations as a release step, and configure backups, logs, alerts, and secret rotation before handling customer data.

Before accepting a pilot payment, complete:

- `docs/admin-operations-release.md`
- `docs/production-launch-owner-checklist.md`
- `docs/database-migration-runbook.md`
- all 21 journeys in `docs/first-client-uat.md`

### Facebook Lead Ads production setup

1. In the Meta app, configure `FACEBOOK_REDIRECT_URL` as the backend OAuth
   callback: `/integrations/facebook/callback`.
2. Configure `FACEBOOK_WEBHOOK_URL` as the public backend endpoint:
   `/webhooks/facebook/lead-ads`.
3. Enter the same strong random value in Meta and
   `FACEBOOK_WEBHOOK_VERIFY_TOKEN`, then subscribe the app's Page object to the
   `leadgen` field.
4. Pin `FACEBOOK_GRAPH_API_VERSION` to an active version supported by the Meta
   app. Revalidate it before Meta's version retirement date.
5. In RealtyTechAI, authorize Facebook, select the brokerage Page, and confirm
   that the integration badge says **Connected**. OAuth authorization by itself
   is intentionally shown as **Test required** until Page subscription succeeds.

## Validation

```bash
cd backend
npm run lint
npm test -- --runInBand
npm run build
npm audit --omit=dev --audit-level=high

cd ../frontend
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

GitHub stores and validates the source but does not host this full-stack application through GitHub Pages. Deploy `frontend/` and `backend/` to suitable application hosts and attach a managed PostgreSQL database.
