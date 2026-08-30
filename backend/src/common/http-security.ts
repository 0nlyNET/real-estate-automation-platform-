import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIES = new Set(['rtai_session', 'rtai_primary_session']);

function hasSessionCookie(request: Request) {
  const cookieHeader = String(request.headers.cookie || '');
  return cookieHeader.split(';').some((part) => {
    const name = part.trim().split('=', 1)[0];
    return SESSION_COOKIES.has(name);
  });
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function apiSecurityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  if (process.env.NODE_ENV === 'production') {
    response.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  next();
}

/**
 * Cookie-authenticated mutations must originate at the configured frontend.
 * Bearer-token and provider-webhook requests do not carry a session cookie and
 * remain usable without a browser Origin header.
 */
export function cookieCsrfProtection(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (SAFE_METHODS.has(request.method.toUpperCase()) || !hasSessionCookie(request)) {
    next();
    return;
  }

  const expected = normalizedOrigin(String(process.env.FRONTEND_URL || ''));
  const supplied = normalizedOrigin(String(request.headers.origin || ''));
  if (!expected || supplied !== expected) {
    response.status(403).json({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Cross-site request rejected',
    });
    return;
  }
  next();
}
