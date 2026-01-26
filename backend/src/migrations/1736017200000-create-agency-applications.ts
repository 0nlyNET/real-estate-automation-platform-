import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyApplications1736017200000 implements MigrationInterface {
  name = 'CreateAgencyApplications1736017200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_applications" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "full_name" text NOT NULL,
        "email" text NOT NULL,
        "phone" text,
        "company" text,
        "team_size" text,
        "lead_sources" text,
        "notes" text,
        "source_page" text,
        "user_agent" text,
        "status" text NOT NULL DEFAULT 'new',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_agency_applications_email" ON "agency_applications" ("email")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_agency_applications_created_at" ON "agency_applications" ("created_at")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_agency_applications_created_at"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_agency_applications_email"');
    await queryRunner.query('DROP TABLE IF EXISTS "agency_applications"');
  }
}
