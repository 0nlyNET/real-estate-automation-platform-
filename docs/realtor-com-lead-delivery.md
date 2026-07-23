# Realtor.com Lead Delivery

## Agent-facing connection flow

RealtyTechAI does not collect or store an agent's Realtor.com password. Realtor.com does not expose a public third-party OAuth handoff for this integration, so the Connections page uses a guided provider setup:

1. The workspace owner selects **Connect Realtor.com**.
2. RealtyTechAI creates a tenant-specific HTTPS lead-delivery URL, application login name, and one-time-visible API key.
3. The official Realtor.com PRO sign-in page opens in a new tab.
4. The agent signs in with their own eligible Realtor.com PRO account.
5. In the PRO dashboard, the agent locates Lead Delivery or API settings, adds another application/open API destination, and pastes the values shown by RealtyTechAI.
6. The agent runs Realtor.com's connection test and saves the setting.
7. RealtyTechAI remains **Awaiting Realtor.com test** until an authenticated test or lead payload reaches the workspace endpoint. It then changes to **Connected**.

Realtor.com product labels and menu placement may differ between eligible accounts. The UI deliberately says to locate Lead Delivery or API settings instead of pretending an OAuth connection completed.

## Security and tenant isolation

- Each workspace receives a unique endpoint and API key.
- The API key is encrypted at rest and returned only when generated or rotated.
- Rotating the key invalidates the previous key immediately and returns the integration to an unverified state.
- The public endpoint validates the key before accepting a test or lead.
- Leads are routed through the existing `LeadsService.intake` workflow, preserving duplicate handling, routing, notifications, and approved automation behavior.
- Disconnecting removes the stored Realtor.com credential for the workspace.

## Backend endpoints

- `GET /integrations/realtor-com` — safe connection status and masked setup metadata.
- `POST /integrations/realtor-com/rotate-key` — creates or rotates the workspace API key. Owner/admin only.
- `DELETE /integrations/realtor-com` — disconnects the workspace. Owner/admin only.
- `POST /webhooks/realtor-com/:tenantId` — authenticated Lead Delivery receiver.

## Required production validation

Do not market the connector as fully production-verified until all of the following are complete:

- `PUBLIC_API_URL` or `BACKEND_URL` resolves to the exact public HTTPS backend origin.
- An eligible Realtor.com agent or broker account exposes the relevant Lead Delivery/API settings.
- The current Realtor.com Lead Delivery API Implementation Guide or provider-issued sample payload has been reviewed.
- Realtor.com's official connection test reaches the tenant endpoint and changes the RealtyTechAI status to **Connected**.
- A real or provider-approved test lead creates exactly one lead in the correct tenant.
- Duplicate delivery, field mapping, response behavior, and failure logging have been verified against the current provider contract.

Until that validation is complete, describe the feature as **guided Realtor.com Lead Delivery setup**, not one-click OAuth.
