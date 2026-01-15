import Link from 'next/link';

type PublicHeaderProps = {
  rightCtaHref?: string;
  rightCtaLabel?: string;
};

export default function PublicHeader({
  rightCtaHref = '/auth/signup',
  rightCtaLabel = 'Sign up',
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
        <Link href="/pricing" style={{ fontSize: 14, opacity: 0.9 }}>
          Pricing
        </Link>
        <Link href="/terms" style={{ fontSize: 14, opacity: 0.9 }}>
          Terms
        </Link>
        <Link href="/privacy" style={{ fontSize: 14, opacity: 0.9 }}>
          Privacy
        </Link>
        <Link href="/auth/signup" style={{ fontSize: 14, fontWeight: 600 }}>
          {rightCtaLabel}
        </Link>
      </nav>
    </header>
  );
}
