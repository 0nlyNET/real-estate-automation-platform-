import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformManagedIntegrations1785024000001
  implements MigrationInterface
{
  name = 'PlatformManagedIntegrations1785024000001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "platform_credentials" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar NOT NULL,
        "encryptedValue" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_credentials_provider" ON "platform_credentials" ("provider")',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "platform_credentials"');
  }
}
