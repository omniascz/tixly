#!/usr/bin/env bash
#
# Tixly — restore database from S3 backup
#
# Usage:
#   ./scripts/restore-from-s3.sh <timestamp> <target-db-url>
#
# Example:
#   ./scripts/restore-from-s3.sh 2026-05-15T04-00-00Z \
#     "postgres://user:pass@localhost:5432/tixly_restore"
#
# Prerequisites:
#   - aws cli configured with read access to S3 bucket
#   - psql + pg_restore + openssl installed
#   - Env: AWS_S3_BUCKET, BACKUP_ENCRYPTION_KEY (stejný jako v GH Actions)

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <timestamp> <target-db-url>"
  echo ""
  echo "List available backups:"
  echo "  aws s3 ls s3://\$AWS_S3_BUCKET/postgres/"
  exit 1
fi

TIMESTAMP="$1"
TARGET_DB="$2"

if [ -z "${AWS_S3_BUCKET:-}" ] || [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "❌ Env AWS_S3_BUCKET a BACKUP_ENCRYPTION_KEY musí být nastaveny"
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "▶ Stahování backupu $TIMESTAMP z S3..."
aws s3 cp "s3://$AWS_S3_BUCKET/postgres/$TIMESTAMP/" "$TMP_DIR/" --recursive

ENC_FILE=$(ls "$TMP_DIR"/*.dump.enc 2>/dev/null | head -1)
if [ -z "$ENC_FILE" ]; then
  echo "❌ Žádný .dump.enc soubor v $TIMESTAMP/"
  exit 1
fi

echo "▶ Dekryptování..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$ENC_FILE" \
  -out "${ENC_FILE%.enc}" \
  -pass "pass:$BACKUP_ENCRYPTION_KEY"

echo "▶ Ověření obsahu..."
pg_restore --list "${ENC_FILE%.enc}" | head -10

echo ""
read -p "Pokračovat s restore do $TARGET_DB? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Zrušeno."
  exit 0
fi

echo "▶ Restore..."
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$TARGET_DB" \
  "${ENC_FILE%.enc}"

echo "✓ Restore hotový. Ověř DB konzistenci:"
echo "  psql \"$TARGET_DB\" -c \"SELECT COUNT(*) FROM identity.users;\""
echo "  psql \"$TARGET_DB\" -c \"SELECT COUNT(*) FROM catalog.events;\""
