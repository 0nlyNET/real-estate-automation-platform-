# Controlled AI lead agent

This runbook covers RealtyTechAI's controlled SMS and email assistant. AI is
disabled by default, every workspace starts in `human_only`, and no workspace
can enter `controlled_autopilot` without explicit configuration, knowledge,
provider, and human approval.

Production voice calling is not part of this release. No voice controls are
exposed in the client or admin interfaces.

## Architecture and message flow

Inbound Twilio SMS and SendGrid Inbound Parse events are authenticated,
tenant-routed, deduplicated, and stored before AI orchestration starts. STOP and
unsubscribe processing and sequence stopping happen first. Webhook requests
only create a durable `ai_runs` job; the in-process AI worker claims jobs with
PostgreSQL `FOR UPDATE SKIP LOCKED`.

`AiConversationService` collects the stored conversation summary plus bounded
recent history, invokes the `AiProvider` abstraction, validates structured
output, executes requests through `AiToolService`, and creates either:

- an AI-authored `draft` message for review; or
- an AI-authored queued message for controlled autopilot.

`OpenAiProvider` is the only direct model integration. It uses the OpenAI
Responses API, strict JSON-schema output, `store: false`, a server-only key, a
bounded timeout, at most one retry, and an in-process circuit breaker. The
provider never receives database access or arbitrary HTTP/SQL capabilities.

All outbound AI messages use the existing RealtyTechAI message worker and
Twilio/SendGrid provider pipeline. Consent, entitlement, provider readiness,
quiet hours, conversation ownership, workspace pause, platform pause, and
human-response races are rechecked before provider submission.

## Operating modes and approval

| Mode | Behavior |
| --- | --- |
| `human_only` | No model generation or AI sending. Existing approved template automation remains separately controlled. |
| `draft` | A validated AI proposal is stored with `draft` status. An authorized user must approve, edit and send, reject, or take over. |
| `controlled_autopilot` | A validated response may enter the existing outbound queue. Restricted or uncertain messages become human handoffs. |

Changing any approval-sensitive setting or approved business information
immediately disables AI and returns the configuration to draft. Enabling AI
requires this order:

1. Connect and successfully test Twilio and/or SendGrid for the intended
   channel.
2. Save public brokerage information, service areas, contact information,
   approved FAQs/questions, escalation instructions, prohibited topics, and
   any required disclaimer.
3. Approve that brokerage information.
4. Save an identity label and choose `draft` or explicitly confirm
   `controlled_autopilot`.
5. Approve the AI configuration.
6. Enable the approved assistant.
7. Complete the controlled test in this document before any production use.

Only workspace owners/admins can change or approve AI configuration. Assigned
agents, transaction coordinators, admins, and owners can use conversation
controls subject to tenant and lead assignment checks.

## Ownership and human control

Every lead has one persistent status: `ai_handling`, `human_handling`,
`waiting_for_human`, `paused`, or `closed`.

**Take Over** obtains a tenant-and-lead PostgreSQL advisory lock, cancels
pending AI messages, stops active follow-up, records the actor and timestamp,
sets `human_handling`, opens a handoff, notifies the assigned user, and writes
an audit event. Any manual SMS or email reply performs the same ownership
switch while holding that lock. Manual email replies are queued through the
existing SendGrid worker.

**Return to AI** requires confirmation, authorized lead access, no open
handoff, valid consent, active service entitlement, approved/enabled settings
and knowledge, a configured model provider, and no platform/workspace pause.
It is audited and resets the consecutive AI-turn count.

The message worker holds the same advisory lock across the final ownership
check, provider request, and accepted-state persistence. AI and human sends
therefore cannot pass their final checks concurrently.

## Tool and response policy

The only model-requestable tools are:

- `get_lead_context`
- `get_conversation_history`
- `get_verified_business_information`
- `update_lead_qualification`
- `update_conversation_summary`
- `set_lead_temperature`
- `set_next_action`
- `send_verified_booking_link`
- `create_or_update_appointment`
- `create_human_handoff`
- `pause_ai_for_lead`
- `notify_assigned_agent`

Every request is parsed as a bounded JSON object and revalidated against the
tenant, lead, triggering inbound message, ownership state, AI/platform pause,
consent, service entitlement, allowed fields, and tool-specific constraints.
Appointments use a deterministic external event ID for idempotency. Booking
links are returned only when the existing verified timestamp and safe-URL
checks pass. Unknown tools, arbitrary URLs/fields/SQL, malformed arguments, and
cross-tenant context are blocked and audited.

Deterministic policy stops before a model call for human/professional requests,
contracts/offers/negotiation, lending/tax questions, fair-housing-sensitive
requests, safety/emergencies, distress/complaints, binding decisions, and
prompt-injection attempts. Model handoff, low confidence, conflicting lead
data, failed tools/providers, missing approval, invalid consent, suspended
service, usage limits, and maximum turns also create human work.

Before a reply can be queued, RealtyTechAI enforces the approved AI identity on
the first response, appends and validates any required disclaimer, blocks
restricted language and workspace-prohibited topics, permits only the verified
booking URL, and enforces SMS/email length limits. Email adds the existing
unsubscribe placeholder before entering the queue.

## Data, privacy, and retention

Migration `ControlledAiLeadAgent1784937600001` adds:

- `workspace_ai_settings`
- `brokerage_ai_knowledge`
- `conversation_ai_states`
- `ai_runs`
- `platform_ai_control`
- AI authorship, run, approval/edit, and cancellation metadata on `messages`

The migration backfills existing message authorship as `template` or `system`.
Workspace defaults remain `ai_enabled=false`, `response_mode=human_only`, and
configuration approval `draft`. Foreign keys, unique triggering-message and
tenant/lead indexes, status checks, and usage bounds are applied.

AI runs store provider/model identifiers, confidence, classification, summary,
requested/executed/blocked tools, token usage, estimated cost, latency, and
sanitized errors. They do not store secrets or private chain-of-thought.
Operational AI runs follow `OPERATIONAL_RETENTION_DAYS` through the existing
daily retention worker. Tenant conversation content is not returned by the
platform AI overview.

## Required backend environment

```dotenv
# Server-only model access
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-5.6
AI_MODEL_TIMEOUT_MS=15000
AI_MODEL_MAX_RETRIES=1
AI_MAX_CONTEXT_CHARACTERS=12000
AI_CIRCUIT_BREAKER_FAILURES=5
AI_CIRCUIT_BREAKER_WINDOW_MS=300000
AI_CIRCUIT_BREAKER_COOLDOWN_MS=600000

# Optional cost estimates; set to reviewed provider rates
AI_INPUT_COST_PER_MILLION_USD=
AI_OUTPUT_COST_PER_MILLION_USD=

# Public authenticated SendGrid Inbound Parse endpoint
SENDGRID_INBOUND_WEBHOOK_URL=https://<api-origin>/webhooks/sendgrid/inbound
SENDGRID_INBOUND_USERNAME=<random-user>
SENDGRID_INBOUND_PASSWORD=<strong-random-secret>
```

No model or provider credential may use a `NEXT_PUBLIC_*` name. The platform
Twilio and SendGrid credentials remain centralized. Tenant Twilio subaccount
credentials are encrypted in provider-resource storage, and random SendGrid
reply identities contain routing data but no platform API key.

## Migration and verification

Use one backend replica for the migration step, keep automation and AI paused,
and take a verified database backup first.

```bash
cd backend
npm ci
npm run lint
npm test -- --runInBand
npm run build
npm audit --omit=dev --audit-level=high
npm run migration:show
npm run migration:run
npm run migration:show
```

The second `migration:show` must list no pending migration. Then verify
`GET /health/readiness` and inspect the five new tables, message columns,
foreign keys, check constraints, indexes, and default-off values. Do not use
`TYPEORM_SYNC=true` in production.

```bash
cd ../frontend
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

## Controlled end-to-end launch gate

Use synthetic contacts controlled by the test team and retain timestamps,
message IDs, screenshots, audit rows, and provider delivery IDs. A compile,
mock provider response, or local unit test is not evidence for this gate.

1. Create or select a dedicated test tenant; confirm AI is disabled and
   `human_only`.
2. Connect/test the intended Twilio and SendGrid accounts and exact SendGrid
   inbound routing address.
3. Save and approve synthetic brokerage knowledge and the disclosed AI
   identity.
4. Set `draft`, approve settings, and enable AI.
5. Submit a controlled test lead with affirmative consent.
6. Send an inbound SMS or email and confirm exactly one stored inbound event
   and one AI run.
7. Confirm a draft appears without a provider send.
8. Approve the draft and confirm queue, provider acceptance/delivery, visible
   AI authorship, disclosure, disclaimer, audit, and usage.
9. Explicitly select and approve `controlled_autopilot`.
10. Send a permitted qualification question and confirm exactly one automatic
    queued/delivered reply using only approved information.
11. Select **Take Over** while another permitted inbound is processing; confirm
    pending AI work is canceled and no AI provider send occurs.
12. Send manual SMS and email replies; confirm human authorship and persistent
    `human_handling`.
13. Resolve open handoffs, confirm **Return to AI**, and verify its audit event.
14. Trigger a legal, lending, fair-housing, or binding-decision question;
    confirm no reply, `waiting_for_human`, Today work, notification, summary,
    reason, priority, and next action.
15. Send STOP and an email unsubscribe request; confirm opt-out is stored before
    orchestration, sequences stop, and no later AI/template/manual send is
    accepted.
16. Exercise quiet hours, missing consent, suspended service, unverified
    booking link, usage limit, model timeout, and tool failure; confirm safe
    delay or handoff without improvised replies.
17. Replay each provider event and run two workers; confirm one run/reply.
18. Use a second tenant and direct IDs from the first; confirm every API/tool
    access is rejected and no content appears in the second tenant or platform
    AI aggregate.
19. Activate workspace and platform emergency pauses; confirm queued AI work
    is canceled while login, inbox, leads, manual messaging, appointments, and
    normal lead intake remain available.

Do not enable a real client until every step passes and the client owner and
platform owner approve the retained evidence.

## Failure and incident response

Model or tool failure stores the inbound message, sends no improvised response,
sanitizes the run failure, sets human ownership, creates a handoff/Today task,
and notifies the assigned user. AI provider-send uncertainty is not retried
automatically; it becomes human work to avoid duplicate sends.

For a tenant incident, use the workspace emergency pause. For a platform
incident, use Admin → AI operations → **Pause all AI**. Both controls cancel
pending AI messages and preserve the rest of RealtyTechAI. Clearing a pause
does not silently return conversations to AI; each requires an explicit
authorized return.

## Deployment commands

After the migration, audits, controlled test, approvals, and health gates pass:

```bash
# Backend release artifact
cd backend
npm ci
npm run build
npm run migration:run
npm prune --omit=dev
npm run start:prod

# Frontend release artifact
cd ../frontend
npm ci
npm run build
npm run start
```

Set `NODE_ENV=production`, `TYPEORM_SYNC=false`, `RUN_MIGRATIONS=true`, the
reviewed database/URL/security/provider variables from `.env.example`, and the
AI variables above in the hosting platform. Deploy frontend and backend health
checks separately and verify `/health/live`, `/health/readiness`, login,
manual messaging, and both AI pause controls before removing launch pauses.
