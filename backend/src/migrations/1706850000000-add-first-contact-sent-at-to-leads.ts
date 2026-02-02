import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFirstContactSentAtToLeads1706850000000 implements MigrationInterface {
  name = 'AddFirstContactSentAtToLeads1706850000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS first_contact_sent_at TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE leads
      DROP COLUMN IF EXISTS first_contact_sent_at
    `);
  }
}
