import { MigrationInterface, QueryRunner } from 'typeorm';

export class FacebookOauthStateHardening1788220800002
  implements MigrationInterface
{
  name = 'FacebookOauthStateHardening1788220800002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "calendar_oauth_states" DROP CONSTRAINT IF EXISTS "CK_calendar_oauth_state_provider"',
    );
    await queryRunner.query(`
      ALTER TABLE "calendar_oauth_states"
      ADD CONSTRAINT "CK_calendar_oauth_state_provider"
      CHECK ("provider" IN ('google', 'microsoft', 'calendly', 'facebook'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "calendar_oauth_states" WHERE "provider" = 'facebook'`,
    );
    await queryRunner.query(
      'ALTER TABLE "calendar_oauth_states" DROP CONSTRAINT IF EXISTS "CK_calendar_oauth_state_provider"',
    );
    await queryRunner.query(`
      ALTER TABLE "calendar_oauth_states"
      ADD CONSTRAINT "CK_calendar_oauth_state_provider"
      CHECK ("provider" IN ('google', 'microsoft', 'calendly'))
    `);
  }
}
