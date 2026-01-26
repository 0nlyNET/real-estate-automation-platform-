RealtyTechAI Phases Patch v2 (Agents + Teams + Brokerages quality)

What this adds (high level)
1) Speed-to-lead metrics
- Tracks: firstContactSentAt, firstResponseReceivedAt, firstResponseTimeSec
- Automatically set when your first outbound message is sent and when a lead replies.

2) Qualification fields (MVP)
- Adds: timeline, buyOrRent, preapproved, bestTimeToTalk, tags
- Editable from new Lead Detail page.

3) Teams/Brokerages lead routing (Round Robin)
- Adds tenant settings:
  - roundRobinEnabled
  - roundRobinTeamId
  - roundRobinLastUserId
- Intake will auto-assign leads round-robin for Teams + Enterprise plans when enabled.

4) Dashboard KPIs that matter
- Replaces vanity KPIs with:
  - Avg first response time
  - % contacted within 5 minutes
  - Appointments set (last 7d) based on stage

5) Inbox: My vs Shared
- Adds a scope toggle (mine/shared) and wires it to the existing backend scope support.

6) Leads: new Lead Detail page
- /app/leads/[id]
- Stage + temperature
- Qualification fields
- Tags
- Assignment (admin/owner only) using /users + /leads/:id/assign

What this DOES NOT attempt yet (next patches)
- Real calendar integration (Google Calendar / Calendly style booking)
- Advanced team permission matrices (per-field visibility)
- Brokerage-level templates enforcement and compliance logs
- Full lead source integrations (FB Lead Ads, Zillow, etc)

How to apply
1) From your project root:
   unzip -o rtai_phases_patch_v2.zip -d .

2) Backend: run DB + restart
   - Ensure docker is running (for postgres)
   - From /backend:
     npm run start:dev

3) Frontend: restart
   - From /frontend:
     npm run dev

4) Turn on round robin (Teams/Enterprise)
   - Go to Settings page (tenant settings) and set roundRobinEnabled = true.
   - Optional: set roundRobinTeamId if you want to route only within a team.

Notes
- This patch is additive and aims to not break existing flows.
- If you already have a DB with old schema and synchronize is OFF, you will need migrations.
