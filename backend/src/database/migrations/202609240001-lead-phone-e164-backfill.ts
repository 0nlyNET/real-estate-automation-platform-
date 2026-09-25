import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backfills `leads.phone` to the canonical E164 form.
 *
 * The leads service used to store bare digits (`15551234567`) while the
 * provider ingestion path stores E164 (`+15551234567`). Dedup compares the
 * stored value with exact string equality, so pre-existing bare-digit rows
 * must be rewritten or the two paths keep creating duplicate leads.
 *
 * Idempotent: only rows whose phone is a bare digit string in the valid
 * E164 digit range (8-15 digits) are rewritten by prepending '+'. NULLs,
 * already-E164 values, and anything else are left untouched, so re-running
 * this migration is a no-op.
 */
export class LeadPhoneE164Backfill1790208000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "leads"
      SET "phone" = '+' || "phone"
      WHERE "phone" IS NOT NULL
        AND "phone" NOT LIKE '+%'
        AND "phone" ~ '^[0-9]{8,15}$'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Intentionally a no-op: stripping '+' would corrupt values that were
    // already E164 before the backfill, and re-running up() stays a no-op.
    await queryRunner.query(`SELECT 1`);
  }
}
