import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Worker heartbeat registry (P4/P5 operational hardening): persistent
 * liveness records for every in-process worker/timer plus the durable-job
 * backed recurring scans. Survives restarts so "last success" stays accurate
 * across deploys; the durable-job supervisor and /health/ready consume it.
 *
 * Idempotent: the table is created only if it does not already exist.
 */
export class WorkerHeartbeat1790448000001 implements MigrationInterface {
  name = "WorkerHeartbeat1790448000001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS worker_heartbeat (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_key varchar(120) NOT NULL UNIQUE,
        display_name varchar(160) NOT NULL,
        expected_interval_seconds int NOT NULL DEFAULT 300,
        is_critical boolean NOT NULL DEFAULT false,
        heartbeat_source varchar(20) NOT NULL DEFAULT 'direct',
        last_success_at timestamptz NULL,
        last_error text NULL,
        consecutive_failures int NOT NULL DEFAULT 0,
        last_check_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS worker_heartbeat`);
  }
}
