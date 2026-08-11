import { Injectable } from '@nestjs/common';
import { EmailIdentityService } from './email-identity.service';
import { PlatformIntegrationsService } from './platform-integrations.service';
import { TwilioProvisioningService } from './twilio-provisioning.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Credential } from '../settings/credential.entity';

@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly twilio: TwilioProvisioningService,
    private readonly email: EmailIdentityService,
    private readonly integrations: PlatformIntegrationsService,
    @InjectRepository(Credential)
    private readonly legacyCredentials: Repository<Credential>,
  ) {}

  async reconcileTenantProvisioning(tenantId: string) {
    const results = await Promise.allSettled([
      this.twilio.provisionTenant(tenantId),
      this.email.provisionTenant(tenantId),
    ]);
    const errors = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    );
    const migratedProviders = ['twilio', 'sendgrid'].filter(
      (_, index) => results[index].status === 'fulfilled',
    );
    if (migratedProviders.length) {
      const legacy = await this.legacyCredentials.find({
        where: { tenant: { id: tenantId } as any },
        relations: ['tenant'],
      });
      const obsolete = legacy.filter((row) => migratedProviders.includes(row.provider));
      if (obsolete.length) await this.legacyCredentials.remove(obsolete);
    }
    return {
      ok: errors.length === 0,
      errors,
      resources: await this.integrations.tenantSummary(tenantId),
    };
  }
}
