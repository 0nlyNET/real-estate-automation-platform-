import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  issueSendGridInboundAccessToken,
  normalizeSendGridInboundAuthorization,
  SendGridInboundAuthorizationError,
} from './sendgrid-inbound-oauth';

describe('SendGrid inbound OAuth security', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'rta_sendgrid_inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';
  });

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  function issueToken() {
    return issueSendGridInboundAccessToken({
      grant_type: 'client_credentials',
      client_id: 'rta_sendgrid_inbound',
      client_secret: 'strong-test-password',
      scope: 'webhooks:write',
    });
  }

  function expectedBasicAuthorization() {
    return `Basic ${Buffer.from(
      'rta_sendgrid_inbound:strong-test-password',
    ).toString('base64')}`;
  }

  it('issues and validates a client-credentials bearer token', () => {
    const response = issueToken();

    expect(response).toEqual(
      expect.objectContaining({
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'webhooks:write',
      }),
    );
    expect(response.access_token).toEqual(expect.any(String));
    expect(
      normalizeSendGridInboundAuthorization(
        `Bearer ${response.access_token}`,
      ),
    ).toBe(expectedBasicAuthorization());
  });

  it('accepts case-insensitive Bearer schemes and normal horizontal whitespace', () => {
    const response = issueToken();
    expect(
      normalizeSendGridInboundAuthorization(
        `  bearer\t  ${response.access_token}  `,
      ),
    ).toBe(expectedBasicAuthorization());
  });

  it('accepts OAuth client credentials through case-insensitive HTTP Basic auth', () => {
    const authorization = `basic\t${Buffer.from(
      'rta_sendgrid_inbound:strong-test-password',
    ).toString('base64')}`;
    const response = issueSendGridInboundAccessToken(
      { grant_type: 'client_credentials' },
      authorization,
    );
    expect(response.access_token).toEqual(expect.any(String));
  });

  it('rejects invalid OAuth client credentials', () => {
    expect(() =>
      issueSendGridInboundAccessToken({
        grant_type: 'client_credentials',
        client_id: 'rta_sendgrid_inbound',
        client_secret: 'wrong-password',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects unsupported OAuth grant types', () => {
    expect(() =>
      issueSendGridInboundAccessToken({
        grant_type: 'password',
        client_id: 'rta_sendgrid_inbound',
        client_secret: 'strong-test-password',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a tampered bearer token with the OAuth invalid_token error', () => {
    const response = issueToken();
    const replacement = response.access_token.endsWith('a') ? 'b' : 'a';
    const tampered = `${response.access_token.slice(0, -1)}${replacement}`;

    try {
      normalizeSendGridInboundAuthorization(`Bearer ${tampered}`);
      throw new Error('Expected token validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SendGridInboundAuthorizationError);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        error: 'invalid_token',
      });
      expect((error as SendGridInboundAuthorizationError).reason).toBe(
        'signature_mismatch',
      );
    }
  });

  it('rejects expired bearer tokens', () => {
    const issuedAt = Date.now();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(issuedAt);
    const response = issueToken();
    dateNow.mockReturnValue(issuedAt + 60 * 60 * 1000 + 1_000);

    try {
      normalizeSendGridInboundAuthorization(
        `Bearer ${response.access_token}`,
      );
      throw new Error('Expected token validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SendGridInboundAuthorizationError);
      expect((error as SendGridInboundAuthorizationError).reason).toBe(
        'expired_token',
      );
    }
  });

  it('preserves and canonicalizes the existing Basic-auth path', () => {
    const encoded = Buffer.from(
      'rta_sendgrid_inbound:strong-test-password',
    ).toString('base64');
    expect(normalizeSendGridInboundAuthorization(` basic   ${encoded} `)).toBe(
      `Basic ${encoded}`,
    );
  });

  it('reports safe internal reasons for missing and unsupported authorization', () => {
    for (const [authorization, reason] of [
      ['', 'missing_authorization'],
      ['Digest opaque-value', 'unsupported_scheme'],
    ] as const) {
      try {
        normalizeSendGridInboundAuthorization(authorization);
        throw new Error('Expected token validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(SendGridInboundAuthorizationError);
        expect((error as SendGridInboundAuthorizationError).reason).toBe(
          reason,
        );
        expect((error as UnauthorizedException).getResponse()).toEqual({
          error: 'invalid_token',
        });
      }
    }
  });
});
