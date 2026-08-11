import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptString } from '../../common/crypto-secrets';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformCredential } from './platform-credential.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';

@Injectable()
export class ProviderConfigService {
  constructor(
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials: Repository<PlatformCredential>,
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources: Repository<TenantMessagingResource>,
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities: Repository<TenantEmailIdentity>,
  ) {}

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
    const authToken = resource.encryptedAuthToken
      ? decryptString(resource.encryptedAuthToken)
      : null;
    if (
      !root?.accountSid ||
      !accountSid ||
      !authToken ||
      resource.twilioParentAccountSid !== root.accountSid
    ) return null;
    return {
      accountSid,
      authToken,
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
        !(options?.allowTesting && identity.emailStatus === 'testing')) ||
      identity.reputationStatus === 'blocked'
    ) return null;
    const root = platform ? decryptIntegrationPayload(platform.encryptedValue) : null;
    if (!root?.apiKey) return null;
    return {
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
