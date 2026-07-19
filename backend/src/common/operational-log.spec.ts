import { operationalEvent, sanitizeOperationalText } from './operational-log';

describe('operational logging redaction', () => {
  it('redacts credentials in fields and free-form provider errors', () => {
    const output = operationalEvent('provider_send_failed', {
      tenantId: 'tenant-a',
      authorization: 'Bearer bearer-secret',
      apiKey: 'SG.provider-secret',
      error:
        'password=plain-secret Authorization: Bearer another-secret sk_live_abc123',
    });

    expect(output).toContain('provider_send_failed');
    expect(output).toContain('tenant-a');
    expect(output).not.toContain('bearer-secret');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('plain-secret');
    expect(output).not.toContain('another-secret');
    expect(output).not.toContain('sk_live_abc123');
  });

  it('bounds untrusted error text', () => {
    expect(sanitizeOperationalText('x'.repeat(2_000), 100)).toHaveLength(100);
  });
});
