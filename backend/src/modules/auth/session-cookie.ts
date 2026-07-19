import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'rtai_session';
export const PRIMARY_SESSION_COOKIE = 'rtai_primary_session';
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function setSessionCookie(
  response: Response,
  token: string,
  name = SESSION_COOKIE,
  maxAge = SESSION_MAX_AGE_MS,
) {
  response.cookie(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(response: Response, name = SESSION_COOKIE) {
  response.clearCookie(name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function readCookie(request: Request, name: string) {
  const header = String(request.headers.cookie || '');
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}
