import { sanitizeAuditMetadata } from './audit-metadata';

describe('audit metadata sanitization', () => {
  it('redacts secrets and request content at every nesting level', () => {
    expect(
      sanitizeAuditMetadata({
        leadId: 'lead-1',
        password: 'do-not-store',
        accessToken: 'camel-case-secret',
        apiKey: 'another-secret',
        nested: {
          auth_token: 'do-not-store',
          authorization: 'Bearer secret',
          body: { notes: 'private request content' },
        },
      }),
    ).toEqual({
      leadId: 'lead-1',
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      nested: {
        auth_token: '[REDACTED]',
        authorization: '[REDACTED]',
        body: '[REDACTED]',
      },
    });
  });

  it('bounds untrusted metadata size', () => {
    const result = sanitizeAuditMetadata({
      long: 'x'.repeat(600),
      values: Array.from({ length: 40 }, (_, index) => index),
    }) as any;
    expect(result.long.length).toBeLessThan(510);
    expect(result.values).toHaveLength(25);
  });
});
