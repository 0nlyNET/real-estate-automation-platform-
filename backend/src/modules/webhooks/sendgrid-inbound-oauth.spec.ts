import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  issueSendGridInboundAccessToken,
  normalizeSendGridInboundAuthorization,
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

  it('issues and validates a client-credentials bearer token', () => {
    const response = issueSendGridInboundAccessToken({
      grant_type: 'client_credentials',
      client_id: 'rta_sendgrid_inbound',
      client_secret: 'strong-test-password',
      scope: 'webhooks:write',
    });

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
    ).toBe(
      `Basic ${Buffer.from(
        'rta_sendgrid_inbound:strong-test-password',
      ).toString('base64')}`,
    );
  });

  it('accepts OAuth client credentials through HTTP Basic auth', () => {
    const authorization = `Basic ${Buffer.from(
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
    const response = issueSendGridInboundAccessToken({
      grant_type: 'client_credentials',
      client_id: 'rta_sendgrid_inbound',
      client_secret: 'strong-test-password',
    });
    const tampered = `${response.access_token.slice(0, -1)}x`;

    try {
      normalizeSendGridInboundAuthorization(`Bearer ${tampered}`);
      throw new Error('Expected token validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        error: 'invalid_token',
      });
    }
  });

  it('rejects expired bearer tokens', () => {
    const issuedAt = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(issuedAt);
    const response = issueSendGridInboundAccessToken({
      grant_type: 'client_credentials',
      client_id: 'rta_sendgrid_inbound',
      client_secret: 'strong-test-password',
    });
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(issuedAt + 60 * 60 * 1000 + 1_000);

    expect(() =>
      normalizeSendGridInboundAuthorization(
        `Bearer ${response.access_token}`,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('preserves the existing Basic-auth path during migration', () => {
    const authorization = `Basic ${Buffer.from(
      'rta_sendgrid_inbound:strong-test-password',
    ).toString('base64')}`;
    expect(normalizeSendGridInboundAuthorization(authorization)).toBe(
      authorization,
    );
  });
});
