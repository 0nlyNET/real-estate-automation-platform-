import { MigrationInterface, QueryRunner } from 'typeorm';

export class ManagedProviderArchitecture1786492800001 implements MigrationInterface {
  name = 'ManagedProviderArchitecture1786492800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "provisioning_status" varchar(40) NOT NULL DEFAULT 'WAITING_FOR_CLIENT',
        ADD COLUMN IF NOT EXISTS "provisioning_last_reconciled_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "provisioning_last_error" text
    `);
    await queryRunner.query(`
      CREATE TABLE "tenant_messaging_resources" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "twilio_parent_account_sid" varchar,
        "twilio_subaccount_sid" varchar,
        "twilio_api_key_sid" varchar,
        "encrypted_api_secret" text,
        "encrypted_auth_token" text,
        "messaging_service_sid" varchar,
        "phone_number_sid" varchar,
        "phone_number" varchar,
        "a2p_customer_profile_sid" varchar,
        "a2p_brand_sid" varchar,
        "a2p_campaign_sid" varchar,
        "a2p_compliance_status" varchar NOT NULL DEFAULT 'not_started',
        "sms_status" varchar NOT NULL DEFAULT 'pending',
        "sms_last_verified_at" timestamptz,
        "provisioning_step" varchar NOT NULL DEFAULT 'not_started',
        "last_error" text,
        "lease_owner" varchar,
        "lease_expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_messaging_resources_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "UQ_tenant_messaging_resources_subaccount" UNIQUE ("twilio_subaccount_sid"),
        CONSTRAINT "UQ_tenant_messaging_resources_service" UNIQUE ("messaging_service_sid"),
        CONSTRAINT "UQ_tenant_messaging_resources_phone" UNIQUE ("phone_number"),
        CONSTRAINT "CK_tenant_messaging_sms_status" CHECK ("sms_status" IN ('pending','provisioning','testing','ready','blocked','failed'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "tenant_email_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "from_email" varchar NOT NULL,
        "from_name" varchar NOT NULL,
        "reply_token" varchar NOT NULL,
        "inbound_address" varchar NOT NULL,
        "signature" text,
        "classification" varchar NOT NULL DEFAULT 'lead_follow_up',
        "reputation_status" varchar NOT NULL DEFAULT 'warming',
        "email_status" varchar NOT NULL DEFAULT 'pending',
        "last_verified_at" timestamptz,
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_email_identities_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "UQ_tenant_email_identities_reply_token" UNIQUE ("reply_token"),
        CONSTRAINT "UQ_tenant_email_identities_inbound" UNIQUE ("inbound_address"),
        CONSTRAINT "CK_tenant_email_status" CHECK ("email_status" IN ('pending','testing','ready','blocked','failed')),
        CONSTRAINT "CK_tenant_email_reputation" CHECK ("reputation_status" IN ('warming','healthy','paused','blocked'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "tenant_email_identities"');
    await queryRunner.query('DROP TABLE IF EXISTS "tenant_messaging_resources"');
    await queryRunner.query(`
      ALTER TABLE "tenants"
        DROP COLUMN IF EXISTS "provisioning_last_error",
        DROP COLUMN IF EXISTS "provisioning_last_reconciled_at",
        DROP COLUMN IF EXISTS "provisioning_status"
    `);
  }
}
