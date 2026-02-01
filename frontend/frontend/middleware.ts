import { NextRequest, NextResponse } from 'next/server';

function getToken(req: NextRequest): string | null {
  return (
    req.cookies.get('rtai_token')?.value ||
    req.cookies.get('accessToken')?.value ||
    req.cookies.get('token')?.value ||
    null
  );
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + pad, 'base64').toString('utf8');
}

function decodeJwt(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function isAdminRole(role?: string): boolean {
  const r = (role || '').toLowerCase();
  return r === 'owner' || r === 'admin';
}

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // ALWAYS PUBLIC: homepage must never redirect
  if (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/logout') ||
    pathname.startsWith('/apply') ||
    pathname.startsWith('/contact') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/about') ||
    pathname.startsWith('/faq') ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/features') ||
    pathname.startsWith('/use-cases') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/security')
  ) {
    return NextResponse.next();
  }

  // Everything else requires auth
  const token = getToken(req);
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const payload = decodeJwt(token);
  const role = String(payload?.role || '');
  if (!role) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const admin = isAdminRole(role);

  // Admin routes: admin only
  if (pathname.startsWith('/admin')) {
    if (!admin) return NextResponse.redirect(new URL('/app/dashboard', req.url));
    return NextResponse.next();
  }

  // Client app routes: any authenticated user
  if (pathname.startsWith('/app')) {
    // Option A: admin defaults to /admin unless explicitly viewing as client
    const asClient = searchParams.get('asClient') === '1';
    if (admin && !asClient) {
      if (pathname === '/app' || pathname === '/app/dashboard') {
        return NextResponse.redirect(new URL('/admin', req.url));
      }
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
