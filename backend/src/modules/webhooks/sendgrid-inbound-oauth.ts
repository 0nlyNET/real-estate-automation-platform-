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

export type SendGridInboundAuthorizationFailureReason =
  | 'missing_authorization'
  | 'malformed_authorization'
  | 'unsupported_scheme'
  | 'credentials_unavailable'
  | 'token_too_large'
  | 'malformed_token'
  | 'signature_mismatch'
  | 'invalid_payload'
  | 'invalid_claims'
  | 'expired_token';

export class SendGridInboundAuthorizationError extends UnauthorizedException {
  constructor(
    readonly reason: SendGridInboundAuthorizationFailureReason,
    readonly scheme?: string,
  ) {
    super({ error: 'invalid_token' });
  }
}

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
  const requestedScope = Array.isArray(body.scope)
    ? body.scope.map((item) => String(item)).join(' ').trim()
    : String(body.scope || '').trim();

  return {
    access_token: `${encodedPayload}.${signature}`,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    ...(requestedScope ? { scope: requestedScope } : {}),
  };
}

export function normalizeSendGridInboundAuthorization(authorization = '') {
  const parsed = parseAuthorizationHeader(authorization);
  if (parsed.scheme === 'basic') {
    return `Basic ${parsed.credentials}`;
  }
  if (parsed.scheme !== 'bearer') {
    invalidToken('unsupported_scheme', parsed.scheme);
  }

  const credentials = configuredCredentials('token');
  const token = parsed.credentials;
  if (token.length > 4096) invalidToken('token_too_large', 'bearer');

  const [encodedPayload, suppliedSignature, extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra) {
    invalidToken('malformed_token', 'bearer');
  }
  const expectedSignature = sign(encodedPayload, credentials.clientSecret);
  if (!safeEqual(expectedSignature, suppliedSignature)) {
    invalidToken('signature_mismatch', 'bearer');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    invalidToken('invalid_payload', 'bearer');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    invalidToken('invalid_payload', 'bearer');
  }
  const payload = decoded as Partial<InboundTokenPayload>;
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    invalidToken('invalid_claims', 'bearer');
  }

  const issuedAt = payload.iat as number;
  const expiresAt = payload.exp as number;
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now) invalidToken('expired_token', 'bearer');
  if (
    payload.iss !== 'realtytechai' ||
    payload.aud !== 'sendgrid-inbound' ||
    !safeEqual(credentials.clientId, String(payload.sub || '')) ||
    typeof payload.jti !== 'string' ||
    !payload.jti ||
    issuedAt > now + CLOCK_SKEW_SECONDS ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS
  ) {
    invalidToken('invalid_claims', 'bearer');
  }

  return `Basic ${Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString('base64')}`;
}

function parseAuthorizationHeader(authorization: string) {
  const trimmed = String(authorization || '').trim();
  if (!trimmed) invalidToken('missing_authorization');

  const match = /^([A-Za-z][A-Za-z0-9_-]*)[\t ]+(.+)$/.exec(trimmed);
  if (!match) invalidToken('malformed_authorization');

  const scheme = match[1].toLowerCase();
  const credentials = match[2].trim();
  if (!credentials || /\s/.test(credentials)) {
    invalidToken('malformed_authorization', scheme);
  }
  return { scheme, credentials };
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
    invalidToken('credentials_unavailable');
  }
  return { clientId, clientSecret };
}

function extractClientCredentials(
  body: OAuthTokenBody,
  authorization: string,
) {
  const match = /^basic[\t ]+([^\s]+)$/i.exec(String(authorization || '').trim());
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
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

function invalidToken(
  reason: SendGridInboundAuthorizationFailureReason,
  scheme?: string,
): never {
  throw new SendGridInboundAuthorizationError(reason, scheme);
}
