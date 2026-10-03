set -e
echo "== kontrola secretu (prazdne)"
( missing=()
  for n in DATABASE_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET AWS_REGION BACKUP_ENCRYPTION_KEY; do
    [ -n "${!n:-}" ] || missing+=("$n")
  done
  if [ ${#missing[@]} -gt 0 ]; then echo "::error title=Záloha NEPROBĚHLA::chybí secrets: ${missing[*]}"; exit 1; fi ) && echo "UNEXPECTED exit 0" || echo "exit=$? (ocekavano 1)"
echo "== dump + encrypt + smoke (testovaci DB ci_check)"
export PGURL=postgresql://neondb_owner:fixowner@localhost:5432/ci_check KEY=testkey-not-secret
cd /tmp && mkdir -p backups && TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
pg_dump --version
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="backups/tixly-$TIMESTAMP.dump" "$PGURL"
cd backups; for f in *.dump; do openssl enc -aes-256-cbc -salt -pbkdf2 -in "$f" -out "$f.enc" -pass env:KEY; rm "$f"; done; ls -lh
set -o pipefail
for f in *.dump.enc; do
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$f" -out "/tmp/${f%.enc}" -pass env:KEY
  n=$(pg_restore --list "/tmp/${f%.enc}" | grep -c ' TABLE ')
  rm "/tmp/${f%.enc}"
  [ "$n" -gt 0 ] || { echo "::error::záloha $f neobsahuje žádnou tabulku"; exit 1; }
  echo "✓ Backup $f: $n tabulek"
done
echo "== spatny klic"
KEY=wrong openssl enc -d -aes-256-cbc -pbkdf2 -in *.dump.enc -out /tmp/x -pass env:KEY 2>&1 | head -1 || true
