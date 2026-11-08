# Launch blocker remediation — November 8, 2026

Production stays paused. No live customer is activated by this change. No migrations or billing eligibility changes are included.

## Candidate changes

- Previously launched PAUSED/SUSPENDED workspaces retain authenticated external leads. Intake records a held event/operator task and never starts AI, templates, or sequences for those leads. Never-launched, TESTING, canceled, and offboarding workspaces retain their strict rules. Manual creation is not given a pause exemption.
- Authenticated external lead intake at the lead cap preserves data but blocks automation. Manual lead creation still enforces its cap. No SMS/consent is inferred; email-only HTTP intake may omit phone.
- The billing grace, handoff escalation and operational reminder timers report actual successful and failed polls to worker heartbeats. The inventory no longer infers their health from unrelated domain activity.
- AI spend with unpriced token usage is shown as unavailable rather than a misleading zero; both input/output rates must be configured for estimates. No unverified price is invented.
- An explicitly configured trusted database CA enables verified TLS; existing Railway connections remain unchanged until that CA is validated and configured.
- Integration restrictions are explained as workspace access/payment restrictions rather than provider outages.
- Includes the email-only onboarding review correction from PR #190.
- Adds a dry-run-first Stripe webhook checker/repair CLI which preserves existing events, verifies exact environment/URL, and reads back changes.

## Sandbox provider repair completed

Endpoint `we_1UJmFAQfK2Gcs87shgs8xuxv` now subscribes to `refund.created` and `charge.dispute.created` in addition to the prior six events. A new sandbox payment/refund generated application billing event `evt_3UZdVlQfK2Gcs87s1IffrdhL`, type refund, amount 100 cents, livemode false, tenant `bcbbea41-5838-4b36-9e70-ac4adca332b5`. No funds moved. Production Stripe endpoint is unchanged pending approval.

## Billing provenance finding

The stale production subscription reference `sub_1U0dMxQfK2Gcs87sErkh4jHJ` exists in the sandbox account, is canceled, and its metadata matches production fixture tenant `dd11ce21-fb97-4610-814a-9ad528d96ebf`. Its production row is PAUSED, has no service activation date, and incorrectly retains active billing status. It is not evidence of live MRR. Do not automatically reconcile all tenants or delete billing history.

Proposed narrowly scoped production correction, AFTER approval: under a transaction and row lock, verify the exact tenant/subscription/PAUSED/no-activation preconditions, retain an audit entry with the previous values, and mark billing status and Stripe subscription status canceled. Keep lifecycle PAUSED, automation disabled and historic provider IDs/payment evidence for audit. Rollback restores only captured billing fields; do not restore automation or grant paid access. Reconfirm the reference against sandbox and absence in the live account immediately before applying.

## Production Stripe configuration change — AFTER approval

Run from the production backend build:

```sh
node dist/scripts/check-stripe-webhook.js we_1UJOuyHo2wRiaNzDYLfKImIj https://real-estate-automation-platform-production.up.railway.app
# After reviewing dry-run output and approval:
node dist/scripts/check-stripe-webhook.js we_1UJOuyHo2wRiaNzDYLfKImIj https://real-estate-automation-platform-production.up.railway.app --apply
```

This adds the two missing event types, never rotates signing secrets or creates a new endpoint. Record old events before applying; rollback removes only the two additions if necessary. Do not issue a live test charge/refund to prove it.

## Remaining access/approval-dependent operations

- Deploy the final exact tested candidate to production only with owner approval. Staging proof does not count as live proof.
- Fresh restore: use `backup-service/restore.sh` with the latest encrypted production object and a NEW isolated database on the staging server. Supply secrets within Railway references, never through logs. Verify decrypt, pg_restore, representative tables, tenant check, RPO/RTO, strict cleanup. Do not restore into either existing app database.
- External monitoring: use an external provider, configure frontend and backend liveness plus protected readiness where supported, and prove an alert reaches the chosen operator destination. A checkbox or internal timer is insufficient. No subscription purchase is authorized by this change.
- Vercel: provider API exposed Hobby-tier retention; actual commercial entitlement remains unverified. Confirm the plan in the signed-in billing screen and approve any required purchase.
- Webhook rotation: coordinate provider/backend credentials atomically and verify authenticated inbound/delivery; do not blindly change `INTEGRATIONS_ENCRYPTION_KEY` or backup encryption keys.
- Ordinary owner rehearsal: use a fresh owned test identity, approved recipient and bounded grant. Do not reverse the existing opt-out or make fake paid-state edits. Credentials/password/verification and binding consent steps require the owner's involvement. No real client onboarding or live payment is required.
- Model rates: populate only rates verified for the actual configured provider/model/account; the code now honestly displays unknown costs until then.

## Scope and limits

This change fixes demonstrated software faults. It does not claim profitability, capacity at 100 clients, legal/tax compliance, or 100% reliability. SMS/booking remain outside Client #1's proposed email-only scope. Moderate dependency advisories require separate compatible patch validation; no major TypeORM upgrade is included.
