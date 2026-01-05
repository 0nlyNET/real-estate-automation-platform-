import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { getToken } from "../lib/auth";
import { copy } from "../content/copy";
import { automationTemplates } from "../content/templates";

type SettingsState = {
  businessPhone: string;
  replyToEmail: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  instantText: boolean;
  instantEmail: boolean;
  stopOnReply: boolean;
  reviewRequest: boolean;
};

const STORAGE_KEY = "rtai_settings_v1";

/**
 * Crash-proof copy fallback:
 * If copy.settings or sections keys are missing, the page still renders.
 */
const fallbackSettingsCopy = {
  title: "Settings",
  subtitle: "Set up your team, lead sources, and follow-ups.",
  sections: {
    team: {
      title: "Team",
      body: "Invite agents and assign leads.",
      ctaInvite: "Invite teammate",
      ctaRoles: "Manage roles",
    },
    sources: {
      title: "Lead sources",
      body: "Connect where your leads come from.",
      ctaFb: "Connect Facebook Leads",
      ctaForm: "Add website form",
      ctaZapier: "Zapier / Webhook",
    },
    messaging: {
      title: "Messaging",
      body: "Connect your business number and reply-to email.",
      alertTitle: "Connect a business number to send texts",
      alertBody:
        "You can still add leads now. Instant texting and follow-ups won’t send until a number is connected.",
      alertCta: "Connect number",
      labelPhone: "Business phone (SMS)",
      labelEmail: "Reply-to email",
      labelQuietStart: "Quiet hours start",
      labelQuietEnd: "Quiet hours end",
    },
    followups: {
      title: "Follow-ups",
      body: "Turn on instant responses and stop the moment they reply.",
      toggleInstantText: "Instant text on new lead",
      toggleInstantEmail: "Instant email on new lead",
      toggleStopOnReply: "Stop follow-ups when they reply",
      toggleReviewRequest: "Send review request after closing",
      editCta: "Edit message",
    },
  },
};

export default function SettingsPage() {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<SettingsState>({
    businessPhone: "",
    replyToEmail: "",
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    instantText: true,
    instantEmail: true,
    stopOnReply: true,
    reviewRequest: true,
  });

  // Use real copy if present; fallback if missing.
  const settingsCopy = useMemo(() => {
    const c: any = (copy as any) || {};
    const s: any = c.settings || {};
    const sections: any = s.sections || {};
    return {
      title: s.title || fallbackSettingsCopy.title,
      subtitle: s.subtitle || fallbackSettingsCopy.subtitle,
      sections: {
        team: {
          title: sections?.team?.title || fallbackSettingsCopy.sections.team.title,
          body: sections?.team?.body || fallbackSettingsCopy.sections.team.body,
          ctaInvite: sections?.team?.ctaInvite || fallbackSettingsCopy.sections.team.ctaInvite,
          ctaRoles: sections?.team?.ctaRoles || fallbackSettingsCopy.sections.team.ctaRoles,
        },
        sources: {
          title: sections?.sources?.title || fallbackSettingsCopy.sections.sources.title,
          body: sections?.sources?.body || fallbackSettingsCopy.sections.sources.body,
          ctaFb: sections?.sources?.ctaFb || fallbackSettingsCopy.sections.sources.ctaFb,
          ctaForm: sections?.sources?.ctaForm || fallbackSettingsCopy.sections.sources.ctaForm,
          ctaZapier: sections?.sources?.ctaZapier || fallbackSettingsCopy.sections.sources.ctaZapier,
        },
        messaging: {
          title: sections?.messaging?.title || fallbackSettingsCopy.sections.messaging.title,
          body: sections?.messaging?.body || fallbackSettingsCopy.sections.messaging.body,
          alertTitle: sections?.messaging?.alertTitle || fallbackSettingsCopy.sections.messaging.alertTitle,
          alertBody: sections?.messaging?.alertBody || fallbackSettingsCopy.sections.messaging.alertBody,
          alertCta: sections?.messaging?.alertCta || fallbackSettingsCopy.sections.messaging.alertCta,
          labelPhone: sections?.messaging?.labelPhone || fallbackSettingsCopy.sections.messaging.labelPhone,
          labelEmail: sections?.messaging?.labelEmail || fallbackSettingsCopy.sections.messaging.labelEmail,
          labelQuietStart: sections?.messaging?.labelQuietStart || fallbackSettingsCopy.sections.messaging.labelQuietStart,
          labelQuietEnd: sections?.messaging?.labelQuietEnd || fallbackSettingsCopy.sections.messaging.labelQuietEnd,
        },
        followups: {
          title: sections?.followups?.title || fallbackSettingsCopy.sections.followups.title,
          body: sections?.followups?.body || fallbackSettingsCopy.sections.followups.body,
          toggleInstantText:
            sections?.followups?.toggleInstantText || fallbackSettingsCopy.sections.followups.toggleInstantText,
          toggleInstantEmail:
            sections?.followups?.toggleInstantEmail || fallbackSettingsCopy.sections.followups.toggleInstantEmail,
          toggleStopOnReply:
            sections?.followups?.toggleStopOnReply || fallbackSettingsCopy.sections.followups.toggleStopOnReply,
          toggleReviewRequest:
            sections?.followups?.toggleReviewRequest || fallbackSettingsCopy.sections.followups.toggleReviewRequest,
          editCta: sections?.followups?.editCta || fallbackSettingsCopy.sections.followups.editCta,
        },
      },
    };
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState((s) => ({ ...s, ...parsed }));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      // ignore
    }
  }

  const needsPhone = useMemo(() => !state.businessPhone.trim(), [state.businessPhone]);

  const globalSaveLabel = (copy as any)?.global?.saveChanges || "Save changes";

  return (
    <AppShell
      title={settingsCopy.title}
      subtitle={settingsCopy.subtitle}
      right={
        <button className="btn" type="button" onClick={persist}>
          {saved ? "Saved" : globalSaveLabel}
        </button>
      }
    >
      {/* Team */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950 }}>{settingsCopy.sections.team.title}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          {settingsCopy.sections.team.body}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button className="btn" type="button" onClick={() => alert("Invite flow coming next")}>
            {settingsCopy.sections.team.ctaInvite}
          </button>
          <button className="btn btnGhost" type="button" onClick={() => alert("Roles coming next")}>
            {settingsCopy.sections.team.ctaRoles}
          </button>
        </div>
      </div>

      {/* Lead sources */}
      <div className="card" id="sources" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950 }}>{settingsCopy.sections.sources.title}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          {settingsCopy.sections.sources.body}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button className="btn" type="button" onClick={() => alert("Facebook Leads integration coming next")}>
            {settingsCopy.sections.sources.ctaFb}
          </button>
          <button className="btn btnGhost" type="button" onClick={() => alert("Website form coming next")}>
            {settingsCopy.sections.sources.ctaForm}
          </button>
          <button className="btn btnGhost" type="button" onClick={() => alert("Webhook/Zapier coming next")}>
            {settingsCopy.sections.sources.ctaZapier}
          </button>
        </div>
      </div>

      {/* Messaging */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950 }}>{settingsCopy.sections.messaging.title}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          {settingsCopy.sections.messaging.body}
        </div>

        {needsPhone ? (
          <div className="alert" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>{settingsCopy.sections.messaging.alertTitle}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {settingsCopy.sections.messaging.alertBody}
            </div>
            <button
              className="btn"
              style={{ marginTop: 10 }}
              type="button"
              onClick={() => alert("Number connection coming next")}
            >
              {settingsCopy.sections.messaging.alertCta}
            </button>
          </div>
        ) : null}

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <label className="small" style={{ display: "block", marginBottom: 6 }}>
              {settingsCopy.sections.messaging.labelPhone}
            </label>
            <input
              value={state.businessPhone}
              onChange={(e) => setState((s) => ({ ...s, businessPhone: e.target.value }))}
              placeholder="(555) 555-5555"
            />
          </div>
          <div>
            <label className="small" style={{ display: "block", marginBottom: 6 }}>
              {settingsCopy.sections.messaging.labelEmail}
            </label>
            <input
              value={state.replyToEmail}
              onChange={(e) => setState((s) => ({ ...s, replyToEmail: e.target.value }))}
              placeholder="you@yourdomain.com"
            />
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <label className="small" style={{ display: "block", marginBottom: 6 }}>
              {settingsCopy.sections.messaging.labelQuietStart}
            </label>
            <input
              type="time"
              value={state.quietHoursStart}
              onChange={(e) => setState((s) => ({ ...s, quietHoursStart: e.target.value }))}
            />
          </div>
          <div>
            <label className="small" style={{ display: "block", marginBottom: 6 }}>
              {settingsCopy.sections.messaging.labelQuietEnd}
            </label>
            <input
              type="time"
              value={state.quietHoursEnd}
              onChange={(e) => setState((s) => ({ ...s, quietHoursEnd: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Follow-ups / automations */}
      <div className="card" id="followups" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950 }}>{settingsCopy.sections.followups.title}</div>
        <div className="muted" style={{ marginTop: 8 }}>
          {settingsCopy.sections.followups.body}
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={state.instantText}
              onChange={(e) => setState((s) => ({ ...s, instantText: e.target.checked }))}
            />
            <span>{settingsCopy.sections.followups.toggleInstantText}</span>
          </label>

          <label className="toggleRow">
            <input
              type="checkbox"
              checked={state.instantEmail}
              onChange={(e) => setState((s) => ({ ...s, instantEmail: e.target.checked }))}
            />
            <span>{settingsCopy.sections.followups.toggleInstantEmail}</span>
          </label>

          <label className="toggleRow">
            <input
              type="checkbox"
              checked={state.stopOnReply}
              onChange={(e) => setState((s) => ({ ...s, stopOnReply: e.target.checked }))}
            />
            <span>{settingsCopy.sections.followups.toggleStopOnReply}</span>
          </label>

          <label className="toggleRow">
            <input
              type="checkbox"
              checked={state.reviewRequest}
              onChange={(e) => setState((s) => ({ ...s, reviewRequest: e.target.checked }))}
            />
            <span>{settingsCopy.sections.followups.toggleReviewRequest}</span>
          </label>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {automationTemplates.map((t) => (
            <div key={t.key} className="card" style={{ background: "transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 950 }}>{t.name}</div>
                  <div className="small" style={{ marginTop: 6 }}>
                    {t.description}
                  </div>
                  <div className="small" style={{ marginTop: 8 }}>
                    {t.rules.map((r) => (
                      <span key={r} className="badge" style={{ marginRight: 8 }}>
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <button className="btn btnGhost" type="button" onClick={() => alert("Editing UI coming next")}>
                  {settingsCopy.sections.followups.editCta}
                </button>
              </div>

              <div className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
                {t.sms?.message ? (
                  <>
                    <b>Text preview:</b>
                    {"\n\n"}
                    {t.sms.message}
                  </>
                ) : null}

                {t.email?.subject ? (
                  <>
                    {"\n\n"}
                    <b>Email preview:</b>
                    {"\n\n"}
                    Subject: {t.email.subject}
                    {"\n\n"}
                    {t.email.body}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}