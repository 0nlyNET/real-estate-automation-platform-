import { operationalEvent, sanitizeOperationalText } from './operational-log';

describe('operational logging redaction', () => {
  it('redacts credentials in fields and free-form provider errors', () => {
    const output = operationalEvent('provider_send_failed', {
      tenantId: 'tenant-a',
      authorization: 'Bearer bearer-secret',
      apiKey: 'SG.provider-secret',
      accessToken: 'opaque-provider-value',
      clientSecret: 'opaque-client-value',
      error:
        'password=plain-secret Authorization: Bearer another-secret sk_live_abc123',
    });

    expect(output).toContain('provider_send_failed');
    expect(output).toContain('tenant-a');
    expect(output).not.toContain('bearer-secret');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('opaque-provider-value');
    expect(output).not.toContain('opaque-client-value');
    expect(output).not.toContain('plain-secret');
    expect(output).not.toContain('another-secret');
    expect(output).not.toContain('sk_live_abc123');
  });

  it('bounds untrusted error text', () => {
    expect(sanitizeOperationalText('x'.repeat(2_000), 100)).toHaveLength(100);
  });

  it('redacts bare webhook signing secrets and restricted keys', () => {
    // A Stripe webhook signing secret echoed unlabeled in an error message
    // must not survive into logs in cleartext.
    const whsec = 'whsec_abcDEF123-_xyz';
    const out = sanitizeOperationalText(
      `Stripe signature verification failed for secret ${whsec} retry`,
    );
    expect(out).not.toContain(whsec);
    expect(out).toContain('[redacted]');

    // Restricted API keys get the same treatment as secret keys.
    const rk = 'rk_live_abcDEF123';
    expect(sanitizeOperationalText(`call failed with key ${rk}`)).not.toContain(
      rk,
    );

    // The object-field path also redacts webhook secrets under any key name
    // that ends in a sensitive word.
    const event = operationalEvent('stripe_webhook_failed', {
      webhookSecret: whsec,
    });
    expect(event).not.toContain(whsec);
  });
});
