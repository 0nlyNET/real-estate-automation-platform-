# External Monitoring Setup — RealtyTechAI

**Status: EXTERNAL ACTION REQUIRED.** The platform now monitors itself
(durable-job supervisor, worker heartbeats, `/health/ready`), but
self-monitoring is **NOT complete** until an external system watches the
platform from the outside. A dead process cannot page about itself. Jayden must
configure the monitor below — until then, a full outage pages nobody.

## What to configure (UptimeRobot or Better Uptime — pick one)

### Check 1 — Frontend (public site)
- **URL:** the production frontend URL (`FRONTEND_URL`, e.g. `https://app.realtytechai.app`)
- **Type:** HTTP(S) keyword or status check, expect **200**
- **Interval:** every **5 minutes**
- **Alert after:** 2 consecutive failures

### Check 2 — Backend liveness (public, no auth)
- **URL:** `<PUBLIC_API_URL>/health/live` (e.g. `https://api.realtytechai.app/health/live`)
- **Type:** HTTP(S), expect **200** with body containing `"status":"up"`
- **Interval:** every **1 minute**
- **Alert after:** 2 consecutive failures
- This endpoint does no I/O on purpose — it answers "is the process alive".

### Check 3 — Backend readiness (authenticated)
- **URL:** `<PUBLIC_API_URL>/health/ready`
- **Type:** HTTP(S), expect **200**; **503** means not ready
- **Auth:** send header `x-health-check-token: <HEALTH_CHECK_TOKEN>` (same value
  as the backend env var; never commit it anywhere)
- **Interval:** every **5 minutes**
- **Alert after:** 2 consecutive failures
- Readiness verifies: database connectivity, migrations applied, schema OK,
  credential storage, durable-job worker health, **and** the P5 worker
  heartbeat inventory — a stale critical worker (durable job worker, AI
  worker, message sender, sequence worker, billing grace monitor,
  health/safety scans) flips this to 503.

## What each alert means and what Jayden does

| Alert | Meaning | Action |
|---|---|---|
| Frontend down | Site unreachable | Check hosting status page; verify DNS; then check backend |
| `/health/live` failing | Backend process down or unreachable | Check Railway/service dashboard; view deploy logs; redeploy last known-good if a fresh deploy broke it |
| `/health/ready` → 503 | Process alive but not healthy | Fetch `/health/ready` manually (with token) and read the `workers` / `durableWorkers` / `database` sections — it names the failing subsystem. Common causes: DB unreachable, pending migrations, stale worker |
| In-app "DurableJobs" incident | Supervisor found failed/exhausted jobs, stuck leases, or a missed critical scan | Open Admin → durable jobs/incidents; inspect `last_error`; fix root cause; re-run or reschedule the job |

## Latency expectations
- `/health/live`: < 100ms (no I/O)
- `/health/ready`: < 2s typical (runs DB checks)
- Frontend: < 3s

## Internal monitors (already running — no action needed)
- **Durable-job supervisor** (`durable_jobs.supervisor_scan`, every 5 min):
  scans for `failed` jobs, repeatedly failing jobs (≥8 attempts), jobs stuck
  past their lease, missed critical cadences (health/safety scans, calendar
  renewals, provisioning), and scheduler inactivity. Alerts via the existing
  incident pipeline with a 6-alerts/hour cap and alert-pipeline exclusions so
  it cannot page-loop about itself.
- **Worker heartbeats** (`worker_heartbeat` table): expected frequency, last
  success, last error, consecutive failures per worker; surfaced in
  `/health/ready` under `workers`; stale critical worker ⇒ readiness 503 ⇒
  external Check 3 fires.
- `EXTERNAL_UPTIME_MONITOR_URL` env: record the monitor's check URL here once
  configured (Admin → Setup tracks whether it is set).

## EXTERNAL ACTION REQUIRED — checklist for Jayden
- [ ] Create the 3 checks above in UptimeRobot/Better Uptime
- [ ] Point alerts at an email + phone number he actually reads
- [ ] Set `EXTERNAL_UPTIME_MONITOR_URL` on the backend to the monitor's check URL
- [ ] Trigger one test alert (pause a check or use the monitor's test feature) and confirm it reaches him

<!-- CI trigger -->
