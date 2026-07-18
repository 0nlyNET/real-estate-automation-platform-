# RealtyTechAI

RealtyTechAI is a multi-tenant lead-response and follow-up platform for real estate teams. The repository contains a Next.js web application and a NestJS/PostgreSQL API.

## What is implemented

- Tenant-scoped leads, users, teams, assignments, messaging, and reporting
- JWT authentication, verified accounts, password reset, role checks, and platform-admin allow-listing
- SMS/email provider credentials encrypted at rest
- Twilio inbound signature verification, opt-outs, quiet hours, and follow-up sequence controls
- Stripe-hosted checkout, billing portal, and subscription webhooks
- Teams-plan routing with fixed-user and round-robin actions
- Public inquiry and protected lead-intake endpoints with validation and rate limits

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

3. Open `http://localhost:3000`. The API health endpoint is `http://localhost:4000/health`.

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

For a fresh local database, temporarily set `TYPEORM_SYNC=true`. Use reviewed migrations for production schema changes.

After building the backend, `npm run seed` creates the initial verified owner from the explicit `SEED_ADMIN_*` environment values.

## Production configuration

See `backend/.env.example` and `frontend/.env.example`. At minimum, configure:

- a strong `JWT_SECRET` and comma-separated `PLATFORM_ADMIN_EMAILS`
- PostgreSQL through `DATABASE_URL`
- a 32-byte `INTEGRATIONS_ENCRYPTION_KEY`
- `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`, and the exact public `TWILIO_WEBHOOK_URL`
- SendGrid, Twilio, Stripe, and Facebook values only for integrations you enable
- `SALES_INBOX_EMAIL` for public contact/application delivery

Terminate HTTPS at the hosting platform, restrict database access, run migrations as a release step, and configure backups, logs, alerts, and secret rotation before handling customer data.

## Validation

```bash
cd backend && npm test && npm run build
cd frontend && npm run build
```

GitHub stores and validates the source but does not host this full-stack application through GitHub Pages. Deploy `frontend/` and `backend/` to suitable application hosts and attach a managed PostgreSQL database.
