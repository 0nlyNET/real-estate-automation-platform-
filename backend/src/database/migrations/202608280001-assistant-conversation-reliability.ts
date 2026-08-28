import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssistantConversationReliability1787875200001 implements MigrationInterface {
  name = 'AssistantConversationReliability1787875200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assistant_runs
        ADD COLUMN IF NOT EXISTS request_id uuid,
        ADD COLUMN IF NOT EXISTS prompt_encrypted text NULL
    `);
    await queryRunner.query(`
      UPDATE assistant_runs
      SET request_id = id
      WHERE request_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE assistant_runs
      ALTER COLUMN request_id SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_assistant_runs_actor_type_request"
      ON assistant_runs(actor_id, assistant_type, request_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_assistant_runs_actor_type_created"
      ON assistant_runs(actor_id, assistant_type, created_at DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_assistant_runs_actor_type_created"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_assistant_runs_actor_type_request"',
    );
    await queryRunner.query(`
      ALTER TABLE assistant_runs
        DROP COLUMN IF EXISTS prompt_encrypted,
        DROP COLUMN IF EXISTS request_id
    `);
  }
}
