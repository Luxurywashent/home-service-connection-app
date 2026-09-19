#!/usr/bin/env bash
#
# Cloud Agent install script for the Home Service Connection mobile app.
#
# Responsibilities (must be idempotent — this may run repeatedly and against
# cached state / a warm snapshot):
#   1. Install locked JS dependencies with pnpm.
#   2. Prepare the Metro web/native assets.
#   3. Provision a local MariaDB instance for the Express/tRPC backend
#      (server/_core) so DB-backed features can be exercised end-to-end.
#      The production backend uses TiDB; MariaDB is a MySQL-compatible local
#      stand-in reachable via DATABASE_URL with no TLS.
#   4. Apply the Drizzle schema (schema-first `drizzle-kit push`, which is the
#      only clean way to build the schema on MySQL/MariaDB — one historical
#      migration, 0035, declares two AUTO_INCREMENT columns which MySQL rejects)
#      and seed one demo detailer.
#   5. Write a local .env pointing the app at the local database.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

MYSQL_HOME="${HSC_MYSQL_HOME:-$HOME/hsc-mysql}"
DATADIR="$MYSQL_HOME/data"
SOCKET="$MYSQL_HOME/mysql.sock"
DB_PORT=3306
DB_NAME=homeservice
DATABASE_URL="mysql://root@127.0.0.1:${DB_PORT}/${DB_NAME}"

log() { printf '\n=== %s ===\n' "$*"; }

log "Installing JS dependencies (pnpm, frozen lockfile)"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

log "Preparing Metro assets"
node scripts/prepare-metro-assets.mjs || true

log "Ensuring MariaDB server is installed"
if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server mariadb-client
  else
    echo "WARN: MariaDB is not installed and sudo is unavailable; skipping DB provisioning." >&2
    exit 0
  fi
fi

MARIADBD="$(command -v mariadbd || command -v mysqld)"

log "Initializing MariaDB data directory"
mkdir -p "$DATADIR"
if [ ! -d "$DATADIR/mysql" ]; then
  mariadb-install-db --no-defaults --auth-root-authentication-method=normal --datadir="$DATADIR" >/dev/null
fi

# Reuse an already-running instance if present; otherwise start a temporary one.
STARTED_TEMP=0
if mysqladmin --socket="$SOCKET" ping >/dev/null 2>&1; then
  log "Reusing already-running MariaDB instance"
else
  log "Starting temporary MariaDB instance for provisioning"
  rm -f "$SOCKET"
  "$MARIADBD" --no-defaults --datadir="$DATADIR" --socket="$SOCKET" \
    --pid-file="$MYSQL_HOME/mysqld.pid" --bind-address=127.0.0.1 --port="$DB_PORT" \
    >"$MYSQL_HOME/mariadb-install.log" 2>&1 &
  STARTED_TEMP=1
  for _ in $(seq 1 30); do
    mysqladmin --socket="$SOCKET" ping >/dev/null 2>&1 && break
    sleep 1
  done
  mysqladmin --socket="$SOCKET" ping >/dev/null 2>&1 || { echo "MariaDB failed to start" >&2; exit 1; }
fi

log "Creating database '${DB_NAME}'"
mysql --socket="$SOCKET" -u root -e \
  "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

log "Writing local .env"
cat > "$REPO_DIR/.env" <<EOF
NODE_ENV=development
PORT=3000
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=dev-local-jwt-secret-not-for-production
EOF

log "Applying Drizzle schema (drizzle-kit push)"
# Only push against an empty database. drizzle-kit 0.31.8 throws while
# re-introspecting an already-populated MariaDB schema, so skip when the schema
# is already present (this keeps the step idempotent on warm re-runs).
TABLE_COUNT="$(mysql --socket="$SOCKET" -N -u root -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}';" 2>/dev/null || echo 0)"
if [ "${TABLE_COUNT:-0}" -lt 5 ]; then
  DATABASE_URL="$DATABASE_URL" pnpm exec drizzle-kit push --force \
    || echo "WARN: drizzle-kit push reported an issue; continuing." >&2
else
  echo "Schema already present (${TABLE_COUNT} tables); skipping push."
fi

log "Seeding a demo detailer"
mysql --socket="$SOCKET" -u root "$DB_NAME" -e \
  "INSERT INTO employees (employee_id, full_name, email, pin, role, city, active_status)
   VALUES ('DET_DEMO_1','Demo Detailer','demo.detailer@example.com','1234','detailer','Niceville','active')
   ON DUPLICATE KEY UPDATE full_name=VALUES(full_name);" || true

if [ "$STARTED_TEMP" -eq 1 ]; then
  log "Stopping temporary MariaDB instance (restarted on boot by start script)"
  mysqladmin --socket="$SOCKET" -u root shutdown || true
  wait 2>/dev/null || true
fi

log "Install complete"
