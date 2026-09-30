import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Preserve the actual provider-bound rendered content for outbound messages.
 *
 * The Message.body field stores the template (with {{...}} tokens). The
 * sendEmail() method renders a separate text value (interpolating tokens,
 * checking for unresolved tokens) and sends THAT to SendGrid. Previously,
 * the rendered content was not persisted — the UI displayed the template,
 * misleading operators into thinking unresolved tokens were sent.
 *
 * This migration adds rendered_body to store the exact provider-bound content.
 * The UI/API must display renderedBody for submitted messages, not body.
 */
export class MessageRenderedBody1790448000002 implements MigrationInterface {
  name = "MessageRenderedBody1790448000002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS rendered_body text NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      DROP COLUMN IF EXISTS rendered_body
    `);
  }
}
