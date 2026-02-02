import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SchemaGuardService implements OnModuleInit {
  private readonly logger = new Logger(SchemaGuardService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.ensureLeadFirstContactSentAt();
  }

  private async ensureLeadFirstContactSentAt() {
    const sql =
      'ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contact_sent_at TIMESTAMPTZ NULL;';

    try {
      await this.dataSource.query(sql);
      this.logger.log('Schema guard ok: leads.first_contact_sent_at ensured');
    } catch (err: any) {
      this.logger.error(
        'Schema guard failed for leads.first_contact_sent_at: ' +
          (err?.message || err),
      );
    }
  }
}
