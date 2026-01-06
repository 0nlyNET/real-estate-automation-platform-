RTAI Perfect Patch Bundle

Includes:
1) Fix Vercel -> Railway network error (frontend env checks + backend CORS)
2) Forgot password end-to-end (backend + frontend pages)
3) Auth rate limiting (Nest Throttler on auth endpoints + global baseline)
4) Tenant settings API (timezone, quiet hours, booking link, automations enabled)
5) Automation kill switch (global env + tenant flag stops enrollments)

How to apply
From the project root:
unzip -o rtai_perfect_patch.zip -d .

Then:

Backend
- cd backend
- npm install
- npm run build
- npm run start:prod (or deploy to Railway)

Frontend
- cd frontend
- npm install
- npm run build
- deploy to Vercel

Required env (Backend, Railway)
- DATABASE_URL (already)
- JWT_SECRET
- FRONTEND_URL=https://<your-vercel-domain>
- FRONTEND_ORIGINS=https://<your-vercel-domain>,http://localhost:3000
- FRONTEND_ALLOW_VERCEL_PREVIEWS=true (optional)

Optional env (Forgot password)
- SENDGRID_API_KEY
- SENDGRID_FROM_EMAIL
- PASSWORD_RESET_TTL_MINUTES=30
- PASSWORD_RESET_ECHO_TOKEN=true (dev only)

Kill switch env (Backend)
- GLOBAL_AUTOMATIONS_DISABLED=true (stops all automated sends)

Frontend env (Vercel)
- NEXT_PUBLIC_API_URL=https://<your-railway-backend-domain>

Notes
- /auth/forgot-password always returns ok:true to prevent account enumeration.
- /settings/tenant reads and writes tenant settings using the logged in user's tenantId.
