import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationInboxPagination1788220800001 implements MigrationInterface {
  name = 'ConversationInboxPagination1788220800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_lead_created_id"
      ON "messages" ("leadId", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_lead_updated_id"
      ON "messages" ("leadId", "updated_at" ASC, "id" ASC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_messages_lead_updated_id"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_messages_lead_created_id"',
    );
  }
}
