import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRole1736017400000 implements MigrationInterface {
  name = 'AddUserRole1736017400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE \"users\" ADD COLUMN IF NOT EXISTS \"role\" varchar(32) NOT NULL DEFAULT 'USER'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN IF EXISTS "role"');
  }
}
