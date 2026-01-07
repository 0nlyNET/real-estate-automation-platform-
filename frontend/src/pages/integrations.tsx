import { useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import EmptyState from "../components/EmptyState";
import UpgradePopover from "../components/UpgradePopover";
import { api } from "../lib/api";
import { getToken } from "../lib/auth";
import { demoActions } from "../lib/demoActions";
import { usePlan } from "../components/PlanContext";
import Link from "next/link";

type FbForm = { id: string; name: string };

export default function IntegrationsPage() {
  const plan = usePlan();
  const [fbConnected, setFbConnected] = useState(false);
  const [fbPageName, setFbPageName] = useState<string | undefined>(undefined);
  const [formsOpen, setFormsOpen] = useState(false);
  const [forms, setForms] = useState<FbForm[]>([]);
  const [zapierKey, setZapierKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [events, setEvents] = useState<Record<string, boolean>>({
    lead_created: true,
    lead_replied: true,
    appointment_booked: true,
  });
  const authed = !!getToken();

  const isPro = plan.planName === "Pro" || plan.planName === "Enterprise";
  const canWebhooks = isPro;

  useEffect(() => {
    // Load server state if authed, otherwise use local demo state
    const localConn = demoActions.getConnections();
    if (localConn["Facebook Lead Ads"]) {
      setFbConnected(true);
      setFbPageName("Jayden Realty Group");
    }
  }, []);

  async function connectFacebook() {
    if (!authed) {
      demoActions.connectSource("Facebook Lead Ads");
      setFbConnected(true);
      setFbPageName("Jayden Realty Group");
      return;
    }
    const res = await api.post("/integrations/facebook/connect", {});
    setFbConnected(true);
    setFbPageName(res.data?.pageName || "Connected Page");
  }

  async function openForms() {
    setFormsOpen(true);
    if (!authed) {
      setForms([
        { id: "form_1", name: "Buyer Inquiry Form" },
        { id: "form_2", name: "Open House RSVP" },
        { id: "form_3", name: "Home Valuation Request" },
      ]);
      return;
    }
    const res = await api.get("/integrations/facebook/forms");
    setForms(res.data?.forms || []);
  }

  async function selectForm(formId: string) {
    setFormsOpen(false);
    if (!authed) return;
    await api.post("/integrations/facebook/select-form", { formId });
  }

  async function generateZapierKey() {
    if (!authed) {
      setZapierKey("zap_demo_" + Math.random().toString(36).slice(2, 10));
      return;
    }
    const res = await api.post("/integrations/zapier/key", {});
    setZapierKey(res.data?.apiKey || null);
  }

  async function saveWebhooks() {
    if (!authed) return;
    await api.put("/integrations/webhooks", {
      url: webhookUrl,
      events: Object.keys(events).filter((k) => events[k]),
    });
  }

  async function testWebhook() {
    if (!authed) return;
    await api.post("/integrations/webhooks/test", {});
    alert("Test webhook sent.");
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <AppShell
      title="Integrations"
      subtitle="Connect lead sources and developer tools in one place."
      right={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn btnGhost" href="/plan">
            Plan
          </Link>
          <Link className="btn" href="/checkout">
            Upgrade
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900 }}>Facebook Lead Ads</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Connect, pick a form, and let new leads hit your pipeline automatically.
              </div>
            </div>
            <div className="pill" style={{ background: fbConnected ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)" }}>
              {fbConnected ? "Connected" : "Not connected"}
            </div>
          </div>

          {fbConnected ? (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div className="listRow">
                <span>Connected page</span>
                <strong>{fbPageName || "Connected"}</strong>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={openForms}>
                  Choose Lead Form
                </button>
                <button className="btn btnGhost" type="button" onClick={() => alert("Sync schedule comes next (Phase 2).")}>
                  Sync schedule
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <EmptyState
                title="Stop losing Facebook leads"
                body="Connect once, then every lead drops into your pipeline with instant replies."
                primary={{
                  label: "Connect Facebook",
                  onClick: connectFacebook,
                }}
                secondary={{
                  label: "Why Pro helps",
                  href: "/pricing#compare",
                }}
              />
            </div>
          )}

          {formsOpen ? (
            <div className="card" style={{ marginTop: 12, padding: 12 }}>
              <div style={{ fontWeight: 900 }}>Choose a Lead Form</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Mocked list for Phase 1. Real syncing is Phase 2+.
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {forms.map((f) => (
                  <button key={f.id} className="btn btnGhost" type="button" onClick={() => selectForm(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn btnGhost" type="button" onClick={() => setFormsOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>Zapier</div>
          <div className="muted" style={{ marginTop: 4 }}>
            Generate an API key per tenant. Use it to trigger “Create lead” zaps later.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {zapierKey ? (
              <div className="card" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  API key
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
                  <code style={{ fontWeight: 900 }}>{zapierKey}</code>
                  <button className="btn btnGhost" type="button" onClick={() => copy(zapierKey)}>
                    Copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="muted">No key yet.</div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={generateZapierKey}>
                Generate API key
              </button>
              <a className="btn btnGhost" href="#" onClick={(e) => (e.preventDefault(), alert("Docs page comes next."))}>
                View Zap templates
              </a>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900 }}>Webhooks</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Push events into your own systems. Great for dev credibility.
              </div>
            </div>
            {!canWebhooks ? (
              <UpgradePopover featureName="Webhooks" message="Upgrade to Pro to unlock Webhooks (developer mode)." upgradeHref="/pricing#compare">
                <span className="pill" style={{ opacity: 0.8 }}>Pro</span>
              </UpgradePopover>
            ) : (
              <span className="pill">Enabled</span>
            )}
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10, opacity: canWebhooks ? 1 : 0.55 }}>
            <label>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
                Webhook URL
              </div>
              <input
                className="input"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                disabled={!canWebhooks}
              />
            </label>

            <div className="card" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 900 }}>
                Events
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {[
                  ["lead_created", "Lead Created"],
                  ["lead_replied", "Lead Replied"],
                  ["appointment_booked", "Appointment Booked"],
                ].map(([key, label]) => (
                  <label key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!events[key]}
                      onChange={(e) => setEvents((cur) => ({ ...cur, [key]: e.target.checked }))}
                      disabled={!canWebhooks}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={saveWebhooks} disabled={!canWebhooks}>
                Save
              </button>
              <button className="btn btnGhost" type="button" onClick={testWebhook} disabled={!canWebhooks}>
                Test webhook
              </button>
            </div>

            {!canWebhooks ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Webhooks are a Pro feature. Click Pro to upgrade.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
