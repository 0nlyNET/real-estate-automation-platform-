import { MigrationInterface, QueryRunner } from "typeorm";

export class ConversationReadState1789862400002 implements MigrationInterface {
  name = "ConversationReadState1789862400002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversation_read_states (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at timestamp NULL,
        last_read_message_id uuid NULL,
        marked_unread boolean NOT NULL DEFAULT false,
        unread_version integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, lead_id, user_id),
        CHECK ((last_read_at IS NULL) = (last_read_message_id IS NULL)),
        CHECK (unread_version >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_inbound_read_watermark"
      ON messages ("leadId", created_at, id) WHERE direction = 'inbound'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_messages_inbound_read_watermark"',
    );
    await queryRunner.query("DROP TABLE IF EXISTS conversation_read_states");
  }
}
