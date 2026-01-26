RealtyTechAI Teams + Brokerages Patch
------------------------------------
How to apply (from project root):

1) Unzip with overwrite:
   unzip -o rtai_teams_brokerages_patch.zip -d .

2) Backend:
   - Ensure DB is reachable.
   - Restart backend. TypeORM will auto-add new columns/tables if synchronize is on.
   - New tables/columns:
     - teams table
     - users.role, users.team_id, users.is_active, users.invited_at, users.invite_token_hash, users.invite_token_expires_at
     - leads.assigned_to_user_id, leads.assigned_to_team_id

3) Frontend:
   - Restart frontend.
   - Sidebar will show "Team" only on Teams/Enterprise plans.

What this adds:
- Roles: owner, admin, agent, tc, read_only (RBAC)
- Teams entity + CRUD (Teams/Enterprise only)
- Seat management endpoints:
  - GET /users (owner/admin see roster; others see self)
  - POST /users (Teams/Enterprise only; seat limits enforced)
  - PATCH /users/:id (role/team/active) (Teams/Enterprise only; admin+)
- Lead assignment:
  - PATCH /leads/:id/assign (Teams/Enterprise; admin+)
  - Role-based visibility: non-admin only sees assigned leads/threads.
- Inbox scoping:
  - GET /threads?scope=mine|shared
- Reporting:
  - GET /stats/agents (Teams/Enterprise; admin+)

Notes:
- Seat limits: pro/trial/free=1 seat; teams=10; enterprise=unlimited (edit backend/src/common/plans.ts).
- Existing tokens still work: role is looked up from DB in JWT strategy.
