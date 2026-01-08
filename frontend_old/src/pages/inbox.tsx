import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import EmptyState from "../components/EmptyState";
import FilterChips from "../components/FilterChips";
import { copy } from "../content/copy";

type Thread = {
  id: string;
  leadName: string;
  stage: string;
  channel: "sms" | "email";
  lastMessage: string;
  lastAt: string;
  status: "needs_reply" | "ok";
};

const mockThreads: Thread[] = [];

export default function InboxPage() {
  const router = useRouter();
  const tab = (router.query.tab as string) || "needs-reply";

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const threads = useMemo(() => {
    if (tab === "needs-reply") return mockThreads.filter((t) => t.status === "needs_reply");
    return mockThreads;
  }, [tab]);

  const selected = threads.find((t) => t.id === selectedId) || null;

  function setTab(next?: string) {
    const q = { ...router.query } as any;
    if (!next) delete q.tab;
    else q.tab = next;
    router.push({ pathname: router.pathname, query: q }, undefined, { shallow: true });
  }

  const chips = useMemo(
    () => [
      { key: "needs-reply", label: "Needs reply", count: mockThreads.filter((t) => t.status === "needs_reply").length },
      { key: "all", label: "All", count: mockThreads.length },
    ],
    []
  );

  const empty = threads.length === 0;

  return (
    <AppShell title={copy.inbox.title} subtitle={copy.inbox.subtitle}>
      <div className="card" style={{ marginTop: 14 }}>
        <FilterChips
          chips={chips}
          activeKey={tab === "all" ? "all" : "needs-reply"}
          onChange={(key) => setTab(key)}
        />
      </div>

      {empty ? (
        <div style={{ marginTop: 14 }}>
          <EmptyState
            title={copy.inbox.empty.title}
            body={copy.inbox.empty.body}
            primary={{ label: copy.inbox.empty.primary, href: "/leads" }}
            secondary={{ label: copy.inbox.empty.secondary, href: "/leads?sample=1" }}
          />

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900 }}>What this becomes next</div>
            <div className="muted" style={{ marginTop: 8 }}>
              Once SMS + email webhooks are wired, this page becomes your “Needs reply” command center. You’ll see every
              reply instantly, plus quick actions like Call, Text, Pause follow-ups, and Move stage.
            </div>
          </div>
        </div>
      ) : (
        <div className="inboxLayout" style={{ marginTop: 14 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={"threadRow" + (t.id === selectedId ? " isActive" : "")}
                onClick={() => setSelectedId(t.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{t.leadName}</div>
                  <div className="small">{new Date(t.lastAt).toLocaleTimeString()}</div>
                </div>
                <div className="small" style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="badge">{t.channel.toUpperCase()}</span>
                  <span className="badge">{t.stage}</span>
                  {t.status === "needs_reply" ? <span className="badge">Needs reply</span> : null}
                </div>
                <div className="muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.35 }}>
                  {t.lastMessage}
                </div>
              </button>
            ))}
          </div>

          <div className="card">
            {selected ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 950, fontSize: 18 }}>{selected.leadName}</div>
                    <div className="small" style={{ marginTop: 6 }}>
                      <span className="badge">{selected.stage}</span>
                      <span className="badge" style={{ marginLeft: 8 }}>{selected.channel.toUpperCase()}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btnGhost" type="button">
                      Call
                    </button>
                    <button className="btn btnGhost" type="button">
                      Text
                    </button>
                    <button className="btn btnGhost" type="button">
                      Email
                    </button>
                    <button className="btn" type="button">
                      Mark as replied
                    </button>
                  </div>
                </div>

                <div className="card" style={{ marginTop: 14 }}>
                  <div className="muted">
                    Messaging is not wired yet in this build. When it is, this panel will show the full conversation,
                    timeline events, and quick reply.
                  </div>
                </div>
              </>
            ) : (
              <div className="muted">Select a conversation on the left.</div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
