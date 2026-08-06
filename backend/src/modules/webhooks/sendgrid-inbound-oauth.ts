import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

type OAuthTokenBody = Record<string, unknown>;

type InboundTokenPayload = {
  iss: 'realtytechai';
  aud: 'sendgrid-inbound';
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

const TOKEN_TTL_SECONDS = 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

export function issueSendGridInboundAccessToken(
  body: OAuthTokenBody,
  authorization = '',
) {
  const expected = configuredCredentials('client');
  const grantType = String(body.grant_type || '').trim();
  if (grantType !== 'client_credentials') {
    throw new BadRequestException({ error: 'unsupported_grant_type' });
  }

  const supplied = extractClientCredentials(body, authorization);
  if (
    !safeEqual(expected.clientId, supplied.clientId) ||
    !safeEqual(expected.clientSecret, supplied.clientSecret)
  ) {
    throw new UnauthorizedException({ error: 'invalid_client' });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: InboundTokenPayload = {
    iss: 'realtytechai',
    aud: 'sendgrid-inbound',
    sub: expected.clientId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: crypto.randomBytes(16).toString('hex'),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, expected.clientSecret);
  const requestedScope = String(body.scope || '').trim();

  return {
    access_token: `${encodedPayload}.${signature}`,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    ...(requestedScope ? { scope: requestedScope } : {}),
  };
}

export function normalizeSendGridInboundAuthorization(authorization = '') {
  if (authorization.startsWith('Basic ')) return authorization;
  if (!authorization.startsWith('Bearer ')) invalidToken();

  const credentials = configuredCredentials('token');
  const token = authorization.slice(7).trim();
  if (!token || token.length > 4096) invalidToken();

  const [encodedPayload, suppliedSignature, extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra) invalidToken();
  const expectedSignature = sign(encodedPayload, credentials.clientSecret);
  if (!safeEqual(expectedSignature, suppliedSignature)) invalidToken();

  let payload: InboundTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    invalidToken();
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== 'realtytechai' ||
    payload.aud !== 'sendgrid-inbound' ||
    !safeEqual(credentials.clientId, String(payload.sub || '')) ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat > now + CLOCK_SKEW_SECONDS ||
    payload.exp <= now
  ) {
    invalidToken();
  }

  return `Basic ${Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString('base64')}`;
}

function configuredCredentials(errorKind: 'client' | 'token') {
  const clientId = String(process.env.SENDGRID_INBOUND_USERNAME || '').trim();
  const clientSecret = String(
    process.env.SENDGRID_INBOUND_PASSWORD || '',
  );
  if (!clientId || !clientSecret) {
    if (errorKind === 'client') {
      throw new UnauthorizedException({ error: 'invalid_client' });
    }
    invalidToken();
  }
  return { clientId, clientSecret };
}

function extractClientCredentials(
  body: OAuthTokenBody,
  authorization: string,
) {
  if (authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(
        authorization.slice(6).trim(),
        'base64',
      ).toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        return {
          clientId: decoded.slice(0, separator),
          clientSecret: decoded.slice(separator + 1),
        };
      }
    } catch {
      // Fall through to form fields and reject them if they are absent.
    }
  }
  return {
    clientId: String(body.client_id || ''),
    clientSecret: String(body.client_secret || ''),
  };
}

function sign(encodedPayload: string, secret: string) {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function safeEqual(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function invalidToken(): never {
  throw new UnauthorizedException({ error: 'invalid_token' });
}
