import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Deduplicates the "AI processing needs human follow-up" alert storm.
 *
 * Root cause: recoverExhaustedRuns() created one operations task per exhausted
 * ai_run with dedupeOpen keyed on the run id, so every interrupted run for the
 * same lead minted a new task. The creation path now dedupes per lead with a
 * 24h throttle; this migration resolves the pre-existing exact duplicates,
 * keeping the earliest unresolved task per (category, title, lead).
 *
 * Conservative and idempotent:
 * - Only touches rows with the exact category + title + related_entity_type
 *   written by the buggy path, and only unresolved statuses.
 * - Tasks whose ai_run row no longer exists are left untouched (the lead
 *   cannot be determined for them) — they need operator review.
 * - Re-running is a no-op: resolved rows no longer match the predicates.
 */
export class AiFollowupTaskDedup1790294400001 implements MigrationInterface {
  name = "AiFollowupTaskDedup1790294400001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE operations_tasks t
      SET status = 'resolved',
          completed_at = now(),
          evidence_note =
            COALESCE(t.evidence_note || ' ', '') ||
            'Auto-deduplicated: duplicate of an earlier open "AI processing needs human follow-up" task for the same lead.'
      FROM ai_runs r
      WHERE t.related_entity_type = 'ai_run'
        AND t.related_entity_id = r.id
        AND t.category = 'ai_provider_failure'
        AND t.title = 'AI processing needs human follow-up'
        AND t.status IN ('open', 'in_progress', 'blocked')
        AND EXISTS (
          SELECT 1
          FROM operations_tasks earlier
          JOIN ai_runs earlier_run
            ON earlier_run.id = earlier.related_entity_id
          WHERE earlier.related_entity_type = 'ai_run'
            AND earlier.category = t.category
            AND earlier.title = t.title
            AND earlier.status IN ('open', 'in_progress', 'blocked')
            AND earlier_run.lead_id = r.lead_id
            AND (earlier.created_at, earlier.id) < (t.created_at, t.id)
        )
    `);
  }

  async down(): Promise<void> {
    // Intentionally irreversible: this is a data cleanup, not a schema
    // change. Resolved duplicate tasks are not restored.
  }
}
