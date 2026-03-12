CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS IDX_password_reset_tokens_token_hash
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS IDX_password_reset_tokens_userId
  ON password_reset_tokens ("userId");
