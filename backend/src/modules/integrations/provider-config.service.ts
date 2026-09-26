import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptString } from '../../common/crypto-secrets';
import { decryptIntegrationPayload } from './integration-crypto';
import { operationalEvent } from '../../common/operational-log';
import { OperationalEventsService } from '../notifications/operational-events.service';
import { PlatformCredential } from './platform-credential.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';

@Injectable()
export class ProviderConfigService {
  private readonly logger = new Logger(ProviderConfigService.name);

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials: Repository<PlatformCredential>,
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources: Repository<TenantMessagingResource>,
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities: Repository<TenantEmailIdentity>,
    @Optional() private readonly operationalEvents?: OperationalEventsService,
  ) {}

  async recordSendGridCredentialFailure(tenantId: string) {
    await this.emailIdentities.update({ tenantId }, {
      emailStatus: 'failed', lastError: 'SendGrid rejected the email credentials or sender permissions. RealtyTechAI operations must retest the connection.',
    });
    // P1: SendGrid credential failures raise the integration incident event
    // (escalating severity is handled by the incident lifecycle). Never
    // breaks the credential bookkeeping itself.
    try {
      await this.operationalEvents?.integrationFailed({
        provider: 'SendGrid',
        tenantId,
        error: 'SendGrid rejected the email credentials or sender permissions.',
        reconnectPath: '/app/settings/integrations',
      });
    } catch (error: unknown) {
      this.logger.warn(
        operationalEvent('sendgrid_credential_failure_event_failed', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async resolveTwilio(tenantId: string, options?: { allowTesting?: boolean }) {
    const resource = await this.messagingResources.findOne({ where: { tenantId } });
    if (
      !resource ||
      (resource.smsStatus !== 'ready' &&
        !(options?.allowTesting && resource.smsStatus === 'testing'))
    ) return null;
    const platform = await this.platformCredentials.findOne({ where: { provider: 'twilio' } });
    const root = platform ? decryptIntegrationPayload(platform.encryptedValue) : null;
    const accountSid = resource.twilioSubaccountSid;
    const apiSecret = resource.encryptedApiSecret
      ? decryptString(resource.encryptedApiSecret)
      : null;
    if (
      !root?.accountSid ||
      !accountSid ||
      !resource.twilioApiKeySid ||
      !apiSecret ||
      resource.twilioParentAccountSid !== root.accountSid
    ) return null;
    return {
      accountSid,
      authToken: apiSecret,
      authUsername: resource.twilioApiKeySid,
      credentialType: 'scoped_api_key' as const,
      fromNumber: resource.phoneNumber || undefined,
      messagingServiceSid: resource.messagingServiceSid || undefined,
    };
  }

  async resolveSendGrid(tenantId: string, options?: { allowTesting?: boolean }) {
    const [identity, platform] = await Promise.all([
      this.emailIdentities.findOne({ where: { tenantId } }),
      this.platformCredentials.findOne({ where: { provider: 'sendgrid' } }),
    ]);
    if (
      !identity ||
      (identity.emailStatus !== 'ready' &&
        !(options?.allowTesting && ['testing', 'failed'].includes(identity.emailStatus))) ||
      ['blocked', 'paused'].includes(identity.reputationStatus)
    ) return null;
    const root = platform ? decryptIntegrationPayload(platform.encryptedValue) : null;
    if (!root?.apiKey || (!options?.allowTesting && (root.connected !== true || root.error || identity.lastError))) return null;
    return {
      connected: true,
      apiKey: String(root.apiKey),
      fromEmail: identity.fromEmail,
      fromName: identity.fromName,
      inboundAddress: identity.inboundAddress,
      routingKey: identity.inboundAddress,
      signature: identity.signature,
      classification: identity.classification,
    };
  }
}
