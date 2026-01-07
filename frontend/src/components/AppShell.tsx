import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "./ThemeToggle";
import Footer from "./Footer";
import { usePlan } from "./PlanContext";
import { logout } from "../lib/auth";

type NavItem = {
  href: string;
  label: string;
  badge?: string;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/leads", label: "Pipeline" },
  { href: "/integrations", label: "Integrations" },
  { href: "/plan", label: "Plan" },
  { href: "/settings", label: "Settings" },
];

export default function AppShell(props: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const path = router.pathname;
  const plan = usePlan();

  return (
    <div className="appShell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Go to home">
          <div className="brandMark" />
          <div>
            <div style={{ lineHeight: 1.1 }}>RealtyTech AI</div>
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>Agent Console</div>
          </div>
        </Link>

        <nav className="sideNav" aria-label="Primary">
          {NAV.map((item) => {
            const active = path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`navItem ${active ? "navItemActive" : ""}`}
              >
                <span style={{ fontWeight: 800 }}>{item.label}</span>
                {item.badge ? <span className="badge">{item.badge}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", display: "grid", gap: 10 }}>
          <Link href="/billing" className="card" style={{ padding: 12, textDecoration: "none" }}>
            <div className="small" style={{ opacity: 0.85 }}>Current plan</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginTop: 4 }}>
<div style={{ fontWeight: 950 }}>{plan.isPreview ? "Freemium Preview" : plan.planName}</div>
              <span className="badge">{plan.isPreview ? "Upgrade" : "Manage"}</span>
            </div>
            <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
              {plan.isPreview ? "Replies + automations locked." : "Billing and limits."}
            </div>
          </Link>
          <ThemeToggle size="sm" />
          <button className="btn btnGhost" type="button" onClick={() => logout("/login")}>Logout</button>
          <div className="small">v0.1 MVP</div>
        </div>
      </aside>

      <main className="content">
        <div className="container">
          <div className="topbar">
            <div>
              <div className="h1" style={{ marginBottom: 4 }}>{props.title}</div>
              {props.subtitle ? <div className="muted">{props.subtitle}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{props.right}</div>
          </div>

          {props.children}

          <Footer />
        </div>
      </main>
    </div>
  );
}
