#!/bin/sh
# RealtyTechAI Postgres Backup to Cloudflare R2
# Runs every 30 minutes via Railway cron
# NEVER log: DATABASE_URL, R2 secrets, encryption keys, auth headers

set -e

# Required env vars (set in Railway, never in code):
#   DATABASE_URL, BACKUP_ENCRYPTION_KEY (base64 32-byte), R2_ACCOUNT_ID,
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, HEARTBEAT_URL (optional)

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILENAME="rta-prod-${TIMESTAMP}.dump.gpg"
WORKDIR="/tmp/rta-backup-$$"
mkdir -p "$WORKDIR"

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "[$(date -u +%FT%TZ)] Starting backup: $FILENAME"

# 1. Dump (custom format, compressed)
echo "Running pg_dump..."
pg_dump --format=custom --compress=9 --no-password "$DATABASE_URL" > "$WORKDIR/backup.dump"
DUMP_SIZE=$(stat -c%s "$WORKDIR/backup.dump" 2>/dev/null || stat -f%z "$WORKDIR/backup.dump")
echo "Dump complete: ${DUMP_SIZE} bytes"

# 2. Encrypt with AES-256 (key from env, never logged)
echo "Encrypting..."
echo "$BACKUP_ENCRYPTION_KEY" | base64 -d | \
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
      --symmetric --cipher-algo AES256 \
      -o "$WORKDIR/$FILENAME" "$WORKDIR/backup.dump"
rm -f "$WORKDIR/backup.dump"
ENC_SIZE=$(stat -c%s "$WORKDIR/$FILENAME" 2>/dev/null || stat -f%z "$WORKDIR/$FILENAME")
echo "Encrypted: ${ENC_SIZE} bytes"

# 3. Upload to R2 via S3-compatible API
echo "Uploading to R2..."
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

aws --endpoint-url "$R2_ENDPOINT" s3 cp "$WORKDIR/$FILENAME" "s3://${R2_BUCKET}/$FILENAME" --only-show-errors
echo "Upload complete"

# 4. Verify upload (head object)
aws --endpoint-url "$R2_ENDPOINT" s3api head-object --bucket "$R2_BUCKET" --key "$FILENAME" --only-show-errors > /dev/null
echo "Upload verified"

# 5. Prune backups older than 7 days
echo "Pruning old backups..."
CUTOFF=$(date -u -d "7 days ago" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -v-7d +%Y%m%dT%H%M%SZ)
aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://${R2_BUCKET}/" --only-show-errors | while read -r _ _ _ key; do
  # key format: rta-prod-YYYYMMDDTHHMMSSZ.dump.gpg
  KEY_TS=$(echo "$key" | sed -n 's/rta-prod-\(.*\)\.dump\.gpg/\1/p')
  if [ -n "$KEY_TS" ] && [ "$KEY_TS" \< "$CUTOFF" ]; then
    echo "Deleting old backup: $key"
    aws --endpoint-url "$R2_ENDPOINT" s3 rm "s3://${R2_BUCKET}/$key" --only-show-errors
  fi
done
echo "Prune complete"

# 6. Heartbeat (failure alerting)
if [ -n "$HEARTBEAT_URL" ]; then
  curl -fsS --max-time 10 "$HEARTBEAT_URL" > /dev/null && echo "Heartbeat sent"
fi

echo "[$(date -u +%FT%TZ)] Backup succeeded: $FILENAME"
