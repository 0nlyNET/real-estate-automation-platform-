import Link from 'next/link';

type PublicHeaderProps = {
  rightCtaHref?: string;
  rightCtaLabel?: string;
  showLogin?: boolean;
};

export default function PublicHeader({
  rightCtaHref = '/auth/signup',
  rightCtaLabel = 'Sign up',
  showLogin = true,
}: PublicHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 0',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img
          src="/favicon-32x32.png"
          alt="RealtyTechAI"
          width={28}
          height={28}
          style={{ borderRadius: 8 }}
        />
        <Link href="/" style={{ fontWeight: 700, fontSize: 16 }}>
          RealtyTechAI
        </Link>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link href="/pricing" style={{ fontSize: 14, color: 'var(--muted)' }}>
          Pricing
        </Link>
        <Link href="/terms" style={{ fontSize: 14, color: 'var(--muted)' }}>
          Terms
        </Link>
        <Link href="/privacy" style={{ fontSize: 14, color: 'var(--muted)' }}>
          Privacy
        </Link>
        {showLogin ? (
          <Link href="/login" className="btnSecondary" style={{ padding: '8px 12px', borderRadius: 999 }}>
            Log in
          </Link>
        ) : null}

        <Link href={rightCtaHref} className="btnPrimary" style={{ padding: '8px 12px', borderRadius: 999 }}>
          {rightCtaLabel}
        </Link>
      </nav>
    </header>
  );
}
