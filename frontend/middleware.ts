import { NextRequest, NextResponse } from 'next/server';

function getToken(req: NextRequest): string | null {
  const cookie =
    req.cookies.get('rtai_token')?.value ||
    req.cookies.get('accessToken')?.value ||
    req.cookies.get('token')?.value;
  return cookie || null;
}

function decode(token: string): any | null {
  try {
    const [, payload] = token.split('.');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes
  if (
    pathname === '/' ||
    pathname.startsWith('/apply') ||
    pathname.startsWith('/contact') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/about') ||
    pathname.startsWith('/faq') ||
    pathname.startsWith('/blog')
  ) {
    return NextResponse.next();
  }

  const token = getToken(req);
  if (!token) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  const payload = decode(token);
  if (!payload?.role) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // Admin routes
  if (pathname.startsWith('/admin')) {
    if (payload.role !== 'owner' && payload.role !== 'admin') {
      return NextResponse.redirect(new URL('/app/dashboard', req.url));
    }
    return NextResponse.next();
  }

  // Client app routes
  if (pathname.startsWith('/app')) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
